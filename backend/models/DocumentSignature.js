const mongoose = require("mongoose");

const documentSignatureSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    /** Signatures bind to a specific version so later edits do not inherit consent. */
    documentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DocumentVersion",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    signerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    signerStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
    },
    signerExternalPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPerson",
      default: null,
    },
    signerName: { type: String, required: true, trim: true },
    signatureUrl: { type: String, default: "" },
    signedAt: { type: Date, required: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

documentSignatureSchema.index({ documentVersionId: 1, signerUserId: 1 });

const DocumentSignature =
  mongoose.models.DocumentSignature ||
  mongoose.model("DocumentSignature", documentSignatureSchema);

module.exports = { DocumentSignature };
