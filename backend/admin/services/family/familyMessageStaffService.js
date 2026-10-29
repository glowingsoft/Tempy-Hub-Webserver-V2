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

const AUDIENCES = { ALL: "all", SELECTED: "selected" };
const MAX_RESIDENTS = 100;

const cleanResidentIds = (value) => {
  const ids = Array.isArray(value) ? value : [];
  const unique = [...new Set(ids.map(String))];
  if (
    !unique.length ||
    unique.length > MAX_RESIDENTS ||
    !unique.every((id) => typeof id === "string" && isValidObjectId(id))
  )
    throw new AppError("invalid_message_audience", 400, { max: MAX_RESIDENTS });
  return unique.map(toObjectId);
};

/** The people a message is for, each once: everyone's next of kin at the site, or the next of kin of chosen residents. */
const recipientsOf = async ({ organizationId, branchId, audience, residentIds }) => {
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

  const rows = await FamilyMember.aggregate([
    { $match: match },
    { $group: { _id: "$userId", residents: { $addToSet: "$residentId" } } },
  ]);
  const covered = new Set(rows.flatMap((row) => row.residents.map(String)));
  return {
    userIds: rows.map((row) => row._id),
    withoutNextOfKin:
      audience === AUDIENCES.SELECTED
        ? residentIds.filter((id) => !covered.has(String(id)))
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

/**
 * A message from the home to next of kin: everyone at the site (audience all) or those of chosen residents
 * (audience selected). Each person gets it in their own thread and cannot reply.
 */
const sendMessage = async ({
  actor,
  organizationId,
  branchId,
  audience,
  residentIds,
  message,
  now = new Date(),
}) => {
  const text = cleanMessageText(message);
  if (!Object.values(AUDIENCES).includes(audience))
    throw new AppError("invalid_message_audience", 400, { max: MAX_RESIDENTS });
  const chosen =
    audience === AUDIENCES.SELECTED ? cleanResidentIds(residentIds) : [];

  const site = await resolveSite({ actor, organizationId, branchId });
  const { userIds, withoutNextOfKin } = await recipientsOf({
    organizationId,
    branchId: site.branchId,
    audience,
    residentIds: chosen,
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
    residentsWithoutNextOfKin: withoutNextOfKin,
  };
};

/** What the home has sent: one row per message however many people it went to, newest first, with how many have read it. */
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

/** One sent message and who got it, with when each person read it; the people are paged. */
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

module.exports = { sendMessage, listSent, getSent, AUDIENCES };
