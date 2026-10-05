const mongoose = require("mongoose");
const { DocumentScope, DocumentCategory } = require("./domainEnums");

const documentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    title: { type: String, required: true, trim: true },
    scope: {
      type: String,
      enum: Object.values(DocumentScope),
      required: true,
    },
    category: {
      type: String,
      enum: Object.values(DocumentCategory),
      default: DocumentCategory.OTHER,
      index: true,
    },
    /**
     * False for read-only material such as newsletters, which would otherwise
     * sit in a reader's action list forever waiting on a signature.
     */
    requiresSignature: { type: Boolean, default: true, index: true },
    currentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DocumentVersion",
      default: null,
    },
  },
  { timestamps: true }
);

const Document =
  mongoose.models.Document || mongoose.model("Document", documentSchema);

module.exports = { Document };
