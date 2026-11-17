const mongoose = require("mongoose");

/** A public, read-only link to one document's latest version; one row per link, so who made it and when is kept after it is revoked. */
const documentShareLinkSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    token: { type: String, required: true, unique: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    active: { type: Boolean, default: true },
    revokedAt: { type: Date, default: null },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

documentShareLinkSchema.index(
  { documentId: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

const DocumentShareLink =
  mongoose.models.DocumentShareLink ||
  mongoose.model("DocumentShareLink", documentShareLinkSchema);

module.exports = { DocumentShareLink };
