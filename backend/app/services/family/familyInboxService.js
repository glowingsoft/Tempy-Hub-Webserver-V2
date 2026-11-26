const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { Membership } = require("@models/Membership");
const { StaffProfile } = require("@models/StaffProfile");
const { JobTitle } = require("@models/JobTitle");
const { MembershipRole } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");
const Message = require("../../../commonModules/chatModule/models/Message");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");

/**
 * The family app's Messages screens: one row per message the home sent, and one message opened.
 * Messages go to the next of kin only and are one-way, the same rule as the chat API and the
 * unread badge. `links` are the caller's active links, read on this request.
 */

const TITLE_LENGTH = 80;
const PREVIEW_LENGTH = 140;

const ROLE_LABELS = {
  [MembershipRole.SUPER_ADMIN]: "Admin",
  [MembershipRole.OWNER]: "Owner",
  [MembershipRole.SITE_MANAGER]: "Site Manager",
  [MembershipRole.LINE_MANAGER]: "Line Manager",
  [MembershipRole.STAFF]: "Staff",
};

const cut = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

// a message sent without a subject is titled by its first line
const titleOf = ({ subject, messageContent }) =>
  subject ||
  cut(String(messageContent || "").split("\n")[0].trim(), TITLE_LENGTH);

const nextOfKinLinks = (links) => links.filter((link) => link.isNextOfKin);

const mine = ({ userId, links }) => ({
  recipientId: toObjectId(userId),
  branchId: {
    $in: nextOfKinLinks(links).map((link) => toObjectId(link.branchId)),
  },
});

/** What to call each sender: their job title at that organization, otherwise their role there. */
const senderRoles = async (rows) => {
  if (!rows.length) return new Map();
  const people = {
    userId: { $in: rows.map((row) => row.senderId) },
    organizationId: { $in: rows.map((row) => row.organizationId) },
  };
  const [profiles, memberships] = await Promise.all([
    StaffProfile.aggregate([
      { $match: people },
      ...joinOne({
        from: JobTitle,
        localField: "jobTitleId",
        as: "jobTitle",
        optional: true,
      }),
      { $project: { userId: 1, organizationId: 1, title: "$jobTitle.name" } },
    ]),
    Membership.aggregate([
      { $match: people },
      // an active membership is read last, so it wins over an old one
      { $sort: { status: -1 } },
      { $project: { userId: 1, organizationId: 1, role: 1 } },
    ]),
  ]);
  const key = (row) => `${row.userId}|${row.organizationId}`;
  const labels = new Map(
    memberships.map((row) => [key(row), ROLE_LABELS[row.role] || ""]),
  );
  profiles.forEach((row) => {
    if (row.title) labels.set(key(row), row.title);
  });
  return new Map(
    rows.map((row) => [
      String(row._id),
      labels.get(`${row.senderId}|${row.organizationId}`) || "",
    ]),
  );
};

const messageStages = [
  ...joinOne({
    from: Branch,
    localField: "branchId",
    as: "home",
    optional: true,
  }),
  ...joinOne({
    from: User,
    localField: "senderId",
    as: "sender",
    optional: true,
  }),
  {
    $project: {
      organizationId: 1,
      branchId: 1,
      conversationId: 1,
      senderId: 1,
      subject: 1,
      messageContent: 1,
      readAt: 1,
      createdAt: 1,
      homeName: { $ifNull: ["$home.name", ""] },
      senderName: { $ifNull: ["$sender.name", ""] },
    },
  },
];

const headerOf = (row, roles) => ({
  messageId: row._id,
  subject: titleOf(row),
  homeName: row.homeName,
  senderName: row.senderName,
  senderRole: roles.get(String(row._id)) || "",
  sentAt: row.createdAt,
});

const listInbox = async ({ userId, links, page, limit, skip }) => {
  const match = mine({ userId, links });
  const [{ data, meta }, unread] = await Promise.all([
    paginateWithFacet({
      model: Message,
      match,
      page,
      limit,
      skip,
      sort: { createdAt: -1, _id: -1 },
      extraDataStages: messageStages,
    }),
    Message.countDocuments({ ...match, readAt: null }),
  ]);
  const roles = await senderRoles(data);

  return {
    data: data.map((row) => ({
      ...headerOf(row, roles),
      preview: cut(row.messageContent || "", PREVIEW_LENGTH),
      isRead: Boolean(row.readAt),
    })),
    meta: {
      ...meta,
      unread,
      // false: the person is nobody's next of kin, so the home does not message them
      receivesMessages: nextOfKinLinks(links).length > 0,
      canReply: false,
    },
  };
};

const markRead = async ({ row, now }) => {
  await Message.updateOne(
    { _id: row._id, readAt: null },
    { $set: { readAt: now } },
  );
  await Conversation.updateOne(
    { _id: row.conversationId },
    {
      $set: {
        unreadCount: await Message.countDocuments({
          conversationId: row.conversationId,
          readAt: null,
        }),
      },
    },
  );
};

/** One message, which opening marks as read. Anyone else's is simply not found. */
const getMessage = async ({ userId, links, messageId, now = new Date() }) => {
  const notFound = () => new AppError("message_not_found", 404);
  if (!isValidObjectId(messageId)) throw notFound();

  const [row] = await Message.aggregate([
    { $match: { _id: toObjectId(messageId), ...mine({ userId, links }) } },
    ...messageStages,
  ]);
  if (!row) throw notFound();

  // the residents this person is next of kin for at the home that wrote
  const about = nextOfKinLinks(links).filter(
    (link) => String(link.branchId) === String(row.branchId),
  );
  const [roles, residents] = await Promise.all([
    senderRoles([row]),
    Resident.aggregate([
      {
        $match: {
          _id: { $in: about.map((link) => toObjectId(link.residentId)) },
        },
      },
      { $sort: { name: 1 } },
      { $project: { name: 1 } },
    ]),
    row.readAt ? null : markRead({ row, now }),
  ]);

  return {
    ...headerOf(row, roles),
    message: row.messageContent,
    to: residents.map((resident) => `${resident.name} Family`).join(", "),
    // for Book A Visit
    residents: residents.map((resident) => ({
      residentId: resident._id,
      residentName: resident.name,
    })),
    isRead: true,
    canReply: false,
  };
};

module.exports = { listInbox, getMessage };
