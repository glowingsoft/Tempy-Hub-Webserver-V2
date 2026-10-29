const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");
const Message = require("../../../commonModules/chatModule/models/Message");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");
const { idText } = require("./familyMessageDelivery");

const { ChatState } = Conversation;

const TABS = {
  inbox: [ChatState.DEFAULT, ChatState.FAVORITE],
  favorite: [ChatState.FAVORITE],
  archived: [ChatState.ARCHIVED],
};

/** Messages from a home are for its next of kin; read live, so losing that role ends access at once. */
const homesOf = async (userId) => {
  const rows = await FamilyMember.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        status: FamilyMemberStatus.ACTIVE,
        isNextOfKin: true,
      },
    },
    { $group: { _id: "$branchId" } },
  ]);
  return rows.map((row) => row._id);
};

const ownThread = async ({ userId, conversationId }) => {
  const id = idText(conversationId);
  if (!id || !isValidObjectId(id))
    throw new AppError("conversation_not_found", 404);
  const homes = await homesOf(userId);
  const [thread] = await Conversation.aggregate([
    {
      $match: {
        _id: toObjectId(id),
        recipientId: toObjectId(userId),
        branchId: { $in: homes },
      },
    },
    ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
    { $project: { branchId: 1, homeName: { $ifNull: ["$home.name", ""] } } },
  ]);
  if (!thread) throw new AppError("conversation_not_found", 404);
  return thread;
};

/** The last message is projected flat and gathered here. */
const lastMessageOf = ({
  lastId,
  lastType,
  lastContent,
  lastSenderId,
  lastSenderName,
  lastAt,
  ...row
}) => ({
  ...row,
  lastMessage: {
    _id: lastId,
    messageType: lastType,
    messageContent: lastContent,
    senderId: lastSenderId,
    senderName: lastSenderName,
    createdAt: lastAt,
  },
});

/** One thread per home, newest first; meta.unread is the badge across every tab. */
const listThreads = async ({ userId, tab = "inbox", page, limit, skip }) => {
  if (!Object.prototype.hasOwnProperty.call(TABS, tab))
    throw new AppError("invalid_chat_tab", 400);
  const homes = await homesOf(userId);
  const base = {
    recipientId: toObjectId(userId),
    branchId: { $in: homes },
    lastMessage: { $ne: null },
  };

  const { result, data, meta } = await paginateWithFacet({
    model: Conversation,
    match: { ...base, chatState: { $in: TABS[tab] } },
    page,
    limit,
    skip,
    sort: { lastMessageAt: -1, _id: -1 },
    extraFacets: {
      unread: [
        { $match: base },
        { $group: { _id: null, count: { $sum: "$unreadCount" } } },
      ],
    },
    extraDataStages: [
      ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
      ...joinOne({ from: Message, localField: "lastMessage", as: "last", optional: true }),
      ...joinOne({ from: User, localField: "last.senderId", as: "sender", optional: true }),
      {
        $project: {
          _id: 0,
          conversationId: "$_id",
          type: { $literal: "group" },
          objectId: "$_id",
          branchId: 1,
          chatName: { $ifNull: ["$home.name", ""] },
          chatIcon: { $literal: null },
          chatState: 1,
          unreadCount: 1,
          canMessage: { $literal: false },
          lastId: "$last._id",
          lastType: "$last.messageType",
          lastContent: "$last.messageContent",
          lastSenderId: "$last.senderId",
          lastSenderName: { $ifNull: ["$sender.name", ""] },
          lastAt: "$last.createdAt",
        },
      },
    ],
  });

  return {
    data: data.map((row) => lastMessageOf(row)),
    meta: { ...meta, unread: result.unread?.[0]?.count ?? 0 },
  };
};

/** Newest first. Opening the first page marks the whole thread read. */
const listMessages = async ({
  userId,
  conversationId,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const thread = await ownThread({ userId, conversationId });

  const { data, meta } = await paginateWithFacet({
    model: Message,
    match: { conversationId: thread._id },
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
          isRead: { $ne: ["$readAt", null] },
        },
      },
    ],
  });

  if (page === 1) {
    await Message.updateMany(
      { conversationId: thread._id, readAt: null },
      { $set: { readAt: now } },
    );
    await Conversation.updateOne(
      { _id: thread._id },
      {
        $set: {
          unreadCount: await Message.countDocuments({
            conversationId: thread._id,
            readAt: null,
          }),
        },
      },
    );
  }

  return {
    data,
    meta: {
      ...meta,
      conversation: {
        conversationId: thread._id,
        chatName: thread.homeName,
        canMessage: false,
      },
    },
  };
};

/** Favorite, archive or move a thread back to the inbox; it only changes how this person sees it. */
const updateThread = async ({ userId, conversationId, action }) => {
  if (!Object.values(ChatState).includes(action))
    throw new AppError("invalid_chat_action", 400);
  const thread = await ownThread({ userId, conversationId });
  await Conversation.updateOne(
    { _id: thread._id, recipientId: toObjectId(userId) },
    { $set: { chatState: action } },
  );
  return { conversationId: thread._id, chatState: action };
};

module.exports = { listThreads, listMessages, updateThread };
