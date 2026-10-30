const mongoose = require("mongoose");

const MAX_MESSAGE_LENGTH = 2000;

/** One row per recipient; a message sent to several people shares a broadcastId. */
const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
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
    broadcastId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messageType: { type: String, enum: ["text"], default: "text" },
    messageContent: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_MESSAGE_LENGTH,
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ organizationId: 1, branchId: 1, broadcastId: 1 });
messageSchema.index({ broadcastId: 1, recipientId: 1 }, { unique: true });

const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);

module.exports = Message;
module.exports.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
