const mongoose = require("mongoose");

const ChatState = {
  DEFAULT: "default",
  FAVORITE: "favorite",
  ARCHIVED: "archived",
};

/**
 * The thread a family member has with one home. Messages come from the home and the member cannot reply, so a
 * thread has exactly one recipient; who sent each message is on the message.
 */
const conversationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    chatState: {
      type: String,
      enum: Object.values(ChatState),
      default: ChatState.DEFAULT,
    },
    unreadCount: { type: Number, default: 0, min: 0 },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationSchema.index({ branchId: 1, recipientId: 1 }, { unique: true });
conversationSchema.index({ recipientId: 1, lastMessageAt: -1 });

const Conversation =
  mongoose.models.Conversation ||
  mongoose.model("Conversation", conversationSchema);

module.exports = Conversation;
module.exports.ChatState = ChatState;
