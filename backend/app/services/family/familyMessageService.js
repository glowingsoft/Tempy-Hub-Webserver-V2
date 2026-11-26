const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");
const Message = require("../../../commonModules/chatModule/models/Message");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");
const { idText } = require("./familyMessageDelivery");
const { readableMatch, activeLinksOf } = require("./familyMessageAccess");

const { ChatState } = Conversation;

const TABS = {
  inbox: [ChatState.DEFAULT, ChatState.FAVORITE],
  favorite: [ChatState.FAVORITE],
  archived: [ChatState.ARCHIVED],
};

const accessOf = async (userId) => {
  const links = await activeLinksOf(userId);
  return {
    homes: links.map((link) => link.branchId),
    readable: {
      recipientId: toObjectId(userId),
      ...readableMatch(links),
    },
  };
};

const ownThread = async ({ userId, conversationId }) => {
  const id = idText(conversationId);
  if (!id || !isValidObjectId(id))
    throw new AppError("conversation_not_found", 404);
  const { homes, readable } = await accessOf(userId);
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
  const any = thread
    ? await Message.countDocuments({ ...readable, conversationId: thread._id })
    : 0;
  if (!any) throw new AppError("conversation_not_found", 404);
  return { ...thread, readable };
};

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

const listThreads = async ({ userId, tab = "inbox", page, limit, skip }) => {
  if (!Object.prototype.hasOwnProperty.call(TABS, tab))
    throw new AppError("invalid_chat_tab", 400);
  const { homes, readable } = await accessOf(userId);
  const summaries = await Message.aggregate([
    { $match: readable },
    {
      $group: {
        _id: "$conversationId",
        unread: {
          $sum: { $cond: [{ $eq: [{ $ifNull: ["$readAt", null] }, null] }, 1, 0] },
        },
      },
    },
  ]);
  const unreadOf = new Map(summaries.map((row) => [String(row._id), row.unread]));
  const base = {
    recipientId: toObjectId(userId),
    branchId: { $in: homes },
    _id: { $in: summaries.map((row) => row._id) },
    lastMessage: { $ne: null },
  };

  const { data, meta } = await paginateWithFacet({
    model: Conversation,
    match: { ...base, chatState: { $in: TABS[tab] } },
    page,
    limit,
    skip,
    sort: { lastMessageAt: -1, _id: -1 },
    extraDataStages: [
      ...joinOne({ from: Branch, localField: "branchId", as: "home", optional: true }),
      {
        $lookup: {
          from: Message.collection.name,
          let: { conversationId: "$_id" },
          pipeline: [
            {
              $match: {
                ...readable,
                $expr: { $eq: ["$conversationId", "$$conversationId"] },
              },
            },
            { $sort: { createdAt: -1, _id: -1 } },
            { $limit: 1 },
          ],
          as: "last",
        },
      },
      { $unwind: { path: "$last", preserveNullAndEmptyArrays: true } },
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
    data: data.map((row) =>
      lastMessageOf({
        ...row,
        unreadCount: unreadOf.get(String(row.conversationId)) ?? 0,
      }),
    ),
    meta: {
      ...meta,
      unread: summaries.reduce((total, row) => total + row.unread, 0),
    },
  };
};

const unreadTotal = async (userId) => {
  const { readable } = await accessOf(userId);
  return Message.countDocuments({ ...readable, readAt: null });
};

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
    match: { ...thread.readable, conversationId: thread._id },
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
          subject: 1,
          messageContent: 1,
          createdAt: 1,
          isRead: { $ne: ["$readAt", null] },
        },
      },
    ],
  });

  if (page === 1) {
    await Message.updateMany(
      { ...thread.readable, conversationId: thread._id, readAt: null },
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

module.exports = { listThreads, listMessages, updateThread, unreadTotal };
