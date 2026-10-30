const mongoose = require("mongoose");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { generateMeta } = require("@utils/responseUtil");
const { paginateWithFacet, facetCount } = require("@utils/paginate");
const { searchText } = require("@utils/familyQuery");
const { AppError } = require("@services/_errors/AppError");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");
const Message = require("../../../commonModules/chatModule/models/Message");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
  personFields,
} = require("@appServices/family/familyPipeline");
const {
  chunksOf,
  cleanMessageText,
  idText,
  ensureThreads,
  deliver,
} = require("@appServices/family/familyMessageDelivery");
const { resolveSite } = require("./familySite");
const { listScope } = require("./familyStaffService");

const AUDIENCES = { ALL: "all", SELECTED: "selected", PEOPLE: "people" };
const MAX_RESIDENTS = 100;
const MAX_PEOPLE = 200;
const CONTACT_ROLE = "Next of kin";

const cleanIds = (value, max) => {
  const ids = Array.isArray(value) ? value : [];
  const unique = [...new Set(ids.map(String))];
  if (
    !unique.length ||
    unique.length > max ||
    !unique.every((id) => typeof id === "string" && isValidObjectId(id))
  )
    throw new AppError("invalid_message_audience", 400, { max });
  return unique.map(toObjectId);
};

/** Keyed "userId|branchId". */
const residentsByPerson = async (people) => {
  const userIds = [...new Set(people.map((p) => String(p.userId)))].map(toObjectId);
  const branchIds = [...new Set(people.map((p) => String(p.branchId)))].map(toObjectId);
  if (!userIds.length) return new Map();
  const links = await FamilyMember.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        branchId: { $in: branchIds },
        status: FamilyMemberStatus.ACTIVE,
        isNextOfKin: true,
      },
    },
    ...joinOne({ from: Resident, localField: "residentId", as: "resident", optional: true }),
    {
      $project: {
        userId: 1,
        branchId: 1,
        residentId: 1,
        name: { $ifNull: ["$resident.name", ""] },
        roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
        phone: { $ifNull: ["$resident.phone", ""] },
        email: { $ifNull: ["$resident.email", ""] },
      },
    },
  ]);
  const byPerson = new Map();
  links.forEach(({ userId, branchId, ...resident }) => {
    const key = `${userId}|${branchId}`;
    byPerson.set(key, [...(byPerson.get(key) ?? []), resident]);
  });
  return byPerson;
};

const recipientsOf = async ({
  organizationId,
  branchId,
  audience,
  residentIds,
  recipientIds,
}) => {
  const match = {
    organizationId: toObjectId(organizationId),
    branchId: toObjectId(branchId),
    status: FamilyMemberStatus.ACTIVE,
    isNextOfKin: true,
  };

  if (audience === AUDIENCES.SELECTED) {
    const found = await Resident.aggregate([
      {
        $match: {
          _id: { $in: residentIds },
          organizationId: match.organizationId,
          branchId: match.branchId,
        },
      },
      { $project: { _id: 1 } },
    ]);
    if (found.length !== residentIds.length)
      throw new AppError("resident_not_found", 404);
    match.residentId = { $in: residentIds };
  }
  if (audience === AUDIENCES.PEOPLE) match.userId = { $in: recipientIds };

  const rows = await FamilyMember.aggregate([
    { $match: match },
    { $group: { _id: "$userId", residents: { $addToSet: "$residentId" } } },
  ]);
  const reached = new Set(rows.map((row) => String(row._id)));
  const covered = new Set(rows.flatMap((row) => row.residents.map(String)));
  return {
    userIds: rows.map((row) => row._id),
    withoutNextOfKin:
      audience === AUDIENCES.SELECTED
        ? residentIds.filter((id) => !covered.has(String(id)))
        : [],
    notReached:
      audience === AUDIENCES.PEOPLE
        ? recipientIds.filter((id) => !reached.has(String(id)))
        : [],
  };
};

const saveMessages = async ({
  organizationId,
  branchId,
  broadcastId,
  senderId,
  text,
  threads,
  now,
}) => {
  const messages = [...threads].map(([recipientId, conversationId]) => ({
    _id: new mongoose.Types.ObjectId(),
    conversationId,
    organizationId,
    branchId,
    broadcastId,
    senderId,
    recipientId: toObjectId(recipientId),
    messageContent: text,
  }));

  for (const chunk of chunksOf(messages)) {
    await Message.insertMany(chunk, { ordered: false });
    await Conversation.bulkWrite(
      chunk.map((message) => ({
        updateOne: {
          filter: { _id: message.conversationId },
          update: {
            $set: { lastMessage: message._id, lastMessageAt: now },
            $inc: { unreadCount: 1 },
          },
        },
      })),
      { ordered: false },
    );
  }
  return messages;
};

const contactInScope = async ({ actor, organizationId, conversationId }) => {
  const id = idText(conversationId);
  if (!id || !isValidObjectId(id))
    throw new AppError("conversation_not_found", 404);
  const scope = await listScope({ actor, organizationId });
  const [contact] = await Conversation.aggregate([
    { $match: { ...scope, _id: toObjectId(id) } },
    ...joinOne({ from: User, localField: "recipientId", as: "user", optional: true }),
    ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
    {
      $project: {
        organizationId: 1,
        branchId: 1,
        recipientId: 1,
        homeName: { $ifNull: ["$home.name", ""] },
        ...personFields("user"),
        email: { $ifNull: ["$user.email", ""] },
        phone: { $ifNull: ["$user.phoneNumber", ""] },
      },
    },
  ]);
  if (!contact) throw new AppError("conversation_not_found", 404);
  return contact;
};

/** audience is all, selected (residentIds) or people (recipientIds); conversationId sends to one contact. */
const sendMessage = async ({
  actor,
  organizationId,
  branchId,
  audience,
  residentIds,
  recipientIds,
  conversationId,
  message,
  now = new Date(),
}) => {
  const text = cleanMessageText(message);

  let site;
  let kind = audience;
  let people = [];
  let residents = [];
  if (conversationId !== undefined) {
    const contact = await contactInScope({ actor, organizationId, conversationId });
    site = { branchId: contact.branchId };
    kind = AUDIENCES.PEOPLE;
    people = [contact.recipientId];
  } else {
    if (!Object.values(AUDIENCES).includes(audience))
      throw new AppError("invalid_message_audience", 400, { max: MAX_RESIDENTS });
    if (audience === AUDIENCES.SELECTED)
      residents = cleanIds(residentIds, MAX_RESIDENTS);
    if (audience === AUDIENCES.PEOPLE) people = cleanIds(recipientIds, MAX_PEOPLE);
    site = await resolveSite({ actor, organizationId, branchId });
  }

  const { userIds, withoutNextOfKin, notReached } = await recipientsOf({
    organizationId,
    branchId: site.branchId,
    audience: kind,
    residentIds: residents,
    recipientIds: people,
  });
  if (!userIds.length) throw new AppError("message_no_recipients", 400);

  const org = toObjectId(organizationId);
  const branch = toObjectId(site.branchId);
  const [home] = await Branch.aggregate([
    { $match: { _id: branch } },
    { $project: { name: 1 } },
  ]);
  const homeName = home?.name || "your home";

  const broadcastId = new mongoose.Types.ObjectId();
  const threads = await ensureThreads({
    organizationId: org,
    branchId: branch,
    recipientIds: userIds,
  });
  const messages = await saveMessages({
    organizationId: org,
    branchId: branch,
    broadcastId,
    senderId: actor._id,
    text,
    threads,
    now,
  });
  await deliver({
    items: messages.map((m) => ({
      receiverId: m.recipientId,
      conversationId: m.conversationId,
      messageId: m._id,
    })),
    subjectId: actor._id,
    senderName: actor.name,
    title: `Message from ${homeName}`,
    chatName: homeName,
    text,
    now,
  });

  return {
    broadcastId,
    sentAt: now,
    recipients: userIds.length,
    conversationId: messages.length === 1 ? messages[0].conversationId : null,
    residentsWithoutNextOfKin: withoutNextOfKin,
    recipientsNotReached: notReached,
  };
};

/** notRead stays true until the contact opens the latest message. */
const listContacts = async ({
  actor,
  organizationId,
  branchId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const base = {
    ...(await listScope({ actor, organizationId, branchId })),
    lastMessage: { $ne: null },
  };

  const text = searchText(keyword);
  if (text) {
    const named = await Conversation.aggregate([
      { $match: base },
      { $group: { _id: "$recipientId" } },
      ...joinOne({ from: User, localField: "_id", as: "user" }),
      { $match: { "user.name": { $regex: text, $options: "i" } } },
      { $project: { _id: 1 } },
    ]);
    base.recipientId = { $in: named.map((row) => row._id) };
  }

  const { data, meta } = await paginateWithFacet({
    model: Conversation,
    match: base,
    page,
    limit,
    skip,
    sort: { lastMessageAt: -1, _id: -1 },
    extraDataStages: [
      ...joinOne({ from: User, localField: "recipientId", as: "user", optional: true }),
      ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
      ...joinOne({ from: Message, localField: "lastMessage", as: "last", optional: true }),
      ...joinOne({ from: User, localField: "last.senderId", as: "sender", optional: true }),
      {
        $project: {
          _id: 0,
          conversationId: "$_id",
          branchId: 1,
          homeName: { $ifNull: ["$home.name", ""] },
          recipientId: 1,
          ...personFields("user"),
          email: { $ifNull: ["$user.email", ""] },
          unreadCount: 1,
          lastId: "$last._id",
          lastContent: "$last.messageContent",
          lastAt: "$last.createdAt",
          lastReadAt: "$last.readAt",
          lastSenderName: { $ifNull: ["$sender.name", ""] },
        },
      },
    ],
  });

  const residents = await residentsByPerson(
    data.map((row) => ({ userId: row.recipientId, branchId: row.branchId })),
  );
  return {
    data: data.map(
      ({ lastId, lastContent, lastAt, lastReadAt, lastSenderName, ...row }) => ({
        ...row,
        roleLabel: CONTACT_ROLE,
        notRead: !lastReadAt,
        lastMessage: {
          _id: lastId,
          messageContent: lastContent,
          senderName: lastSenderName,
          createdAt: lastAt,
          readAt: lastReadAt ?? null,
        },
        residents: residents.get(`${row.recipientId}|${row.branchId}`) ?? [],
      }),
    ),
    meta,
  };
};

const getContact = async ({
  actor,
  organizationId,
  conversationId,
  page,
  limit,
  skip,
}) => {
  const contact = await contactInScope({ actor, organizationId, conversationId });

  const { data, meta } = await paginateWithFacet({
    model: Message,
    match: { conversationId: contact._id },
    page,
    limit,
    skip,
    sort: { createdAt: -1, _id: -1 },
    extraDataStages: [
      ...joinOne({ from: User, localField: "senderId", as: "sender", optional: true }),
      {
        $project: {
          _id: 1,
          conversationId: 1,
          senderId: 1,
          senderName: { $ifNull: ["$sender.name", ""] },
          messageType: 1,
          messageContent: 1,
          createdAt: 1,
          readAt: 1,
          isRead: { $ne: ["$readAt", null] },
        },
      },
    ],
  });

  const residents = await residentsByPerson([
    { userId: contact.recipientId, branchId: contact.branchId },
  ]);
  return {
    data,
    meta: {
      ...meta,
      contact: {
        conversationId: contact._id,
        recipientId: contact.recipientId,
        name: contact.name,
        photoUrl: contact.photoUrl,
        roleLabel: CONTACT_ROLE,
        email: contact.email,
        phone: contact.phone,
        branchId: contact.branchId,
        homeName: contact.homeName,
        residents:
          residents.get(`${contact.recipientId}|${contact.branchId}`) ?? [],
      },
    },
  };
};

const listRecipients = async ({
  actor,
  organizationId,
  branchId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const base = {
    ...(await listScope({ actor, organizationId, branchId })),
    status: FamilyMemberStatus.ACTIVE,
    isNextOfKin: true,
  };

  const text = searchText(keyword);
  if (text) {
    const named = await FamilyMember.aggregate([
      { $match: base },
      { $group: { _id: "$userId" } },
      ...joinOne({ from: User, localField: "_id", as: "user" }),
      { $match: { "user.name": { $regex: text, $options: "i" } } },
      { $project: { _id: 1 } },
    ]);
    base.userId = { $in: named.map((row) => row._id) };
  }

  const [result] = await FamilyMember.aggregate([
    { $match: base },
    { $group: { _id: { userId: "$userId", branchId: "$branchId" } } },
    ...joinOne({ from: User, localField: "_id.userId", as: "user", optional: true }),
    {
      $facet: {
        data: [
          { $sort: { "user.name": 1, "_id.userId": 1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              recipientId: "$_id.userId",
              branchId: "$_id.branchId",
              ...personFields("user"),
              email: { $ifNull: ["$user.email", ""] },
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  const residents = await residentsByPerson(
    result.data.map((row) => ({ userId: row.recipientId, branchId: row.branchId })),
  );
  return {
    data: result.data.map((row) => ({
      ...row,
      roleLabel: CONTACT_ROLE,
      residents: residents.get(`${row.recipientId}|${row.branchId}`) ?? [],
    })),
    meta: generateMeta(page, limit, facetCount(result.totalCount)),
  };
};

const listSent = async ({
  actor,
  organizationId,
  branchId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const match = await listScope({ actor, organizationId, branchId });
  const text = searchText(keyword);
  if (text) match.messageContent = { $regex: text, $options: "i" };

  const [result] = await Message.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$broadcastId",
        message: { $first: "$messageContent" },
        senderId: { $first: "$senderId" },
        branchId: { $first: "$branchId" },
        sentAt: { $min: "$createdAt" },
        recipients: { $sum: 1 },
        readCount: { $sum: { $cond: [{ $ne: ["$readAt", null] }, 1, 0] } },
      },
    },
    {
      $facet: {
        data: [
          { $sort: { sentAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          ...joinOne({ from: User, localField: "senderId", as: "sender", optional: true }),
          ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
          {
            $project: {
              _id: 0,
              broadcastId: "$_id",
              message: 1,
              branchId: 1,
              homeName: { $ifNull: ["$home.name", ""] },
              ...personFields("sender", "sentBy"),
              senderId: 1,
              sentAt: 1,
              recipients: 1,
              readCount: 1,
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  return {
    data: result.data,
    meta: generateMeta(page, limit, facetCount(result.totalCount)),
  };
};

const getSent = async ({ actor, organizationId, broadcastId, page, limit, skip }) => {
  const id = idText(broadcastId);
  if (!id || !isValidObjectId(id)) throw new AppError("message_not_found", 404);
  const scope = await listScope({ actor, organizationId });
  const match = { ...scope, broadcastId: toObjectId(id) };

  const [[summary], { data, meta }] = await Promise.all([
    Message.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$broadcastId",
          message: { $first: "$messageContent" },
          senderId: { $first: "$senderId" },
          branchId: { $first: "$branchId" },
          sentAt: { $min: "$createdAt" },
          recipients: { $sum: 1 },
          readCount: { $sum: { $cond: [{ $ne: ["$readAt", null] }, 1, 0] } },
        },
      },
      ...joinOne({ from: User, localField: "senderId", as: "sender", optional: true }),
      ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
      {
        $project: {
          _id: 0,
          broadcastId: "$_id",
          message: 1,
          branchId: 1,
          homeName: { $ifNull: ["$home.name", ""] },
          ...personFields("sender", "sentBy"),
          sentAt: 1,
          recipients: 1,
          readCount: 1,
        },
      },
    ]),
    paginateWithFacet({
      model: Message,
      match,
      page,
      limit,
      skip,
      sort: { createdAt: 1, _id: 1 },
      extraDataStages: [
        ...joinOne({ from: User, localField: "recipientId", as: "user", optional: true }),
        {
          $project: {
            _id: 0,
            recipientId: 1,
            conversationId: 1,
            ...personFields(),
            email: { $ifNull: ["$user.email", ""] },
            readAt: 1,
          },
        },
      ],
    }),
  ]);
  if (!summary) throw new AppError("message_not_found", 404);

  return { data, meta: { ...meta, message: summary } };
};

module.exports = {
  sendMessage,
  listContacts,
  getContact,
  listRecipients,
  listSent,
  getSent,
};
