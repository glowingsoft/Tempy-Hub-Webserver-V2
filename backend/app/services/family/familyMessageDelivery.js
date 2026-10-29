const { NotificationExp, NotificationTypes } = require("@models/Notifications");
const { AppError } = require("@services/_errors/AppError");
const Conversation = require("../../../commonModules/chatModule/models/Conversation");
const Message = require("../../../commonModules/chatModule/models/Message");
const {
  emitMessageToUsers,
} = require("../../../commonModules/chatModule/sockets/chatEventEmitter");

const { MAX_MESSAGE_LENGTH } = Message;
const CHUNK = 500;
const PREVIEW_LENGTH = 140;

const chunksOf = (items) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
    items.slice(i * CHUNK, (i + 1) * CHUNK),
  );

const cleanMessageText = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > MAX_MESSAGE_LENGTH)
    throw new AppError("invalid_message_text", 400, { max: MAX_MESSAGE_LENGTH });
  return text;
};

const idText = (value) => (typeof value === "string" ? value : undefined);

const ensureThreads = async ({ organizationId, branchId, recipientIds }) => {
  const threads = new Map();
  for (const chunk of chunksOf(recipientIds)) {
    await Conversation.bulkWrite(
      chunk.map((recipientId) => ({
        updateOne: {
          filter: { branchId, recipientId },
          update: { $setOnInsert: { organizationId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    const rows = await Conversation.aggregate([
      { $match: { branchId, recipientId: { $in: chunk } } },
      { $project: { recipientId: 1 } },
    ]);
    rows.forEach((row) => threads.set(String(row.recipientId), row._id));
  }
  return threads;
};

/** A failure here never undoes a message that was saved. */
const deliver = async ({
  items,
  subjectId,
  senderName,
  title,
  chatName,
  text,
  now,
}) => {
  try {
    const preview =
      text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
    for (const chunk of chunksOf(items)) {
      await NotificationExp.insertMany(
        chunk.map((item) => ({
          type: NotificationTypes.NEW_MESSAGE,
          subjectId,
          objectId: item.conversationId,
          objectType: "conversation",
          receiverId: item.receiverId,
          title,
          body: preview,
        })),
        { ordered: false },
      );
    }
  } catch (error) {
    console.error("chat notification failed", error.message);
  }

  try {
    items.forEach((item) =>
      emitMessageToUsers({
        ioOrNamespace: global.io,
        recipientIds: [item.receiverId],
        message: {
          conversationId: item.conversationId,
          messageId: item.messageId,
          senderId: subjectId,
          senderName,
          chatName,
          messageType: "text",
          messageContent: text,
          createdAt: now,
          isRead: false,
        },
      }),
    );
  } catch (error) {
    console.error("chat socket push failed", error.message);
  }
};

module.exports = {
  chunksOf,
  cleanMessageText,
  idText,
  ensureThreads,
  deliver,
};
