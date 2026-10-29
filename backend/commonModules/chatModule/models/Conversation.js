const mongoose = require("mongoose");

const ChatState = {
  DEFAULT: "default",
  FAVORITE: "favorite",
  ARCHIVED: "archived",
};

/** One thread per next of kin per home: the home writes, the member only reads. */
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
