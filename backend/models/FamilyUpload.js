const mongoose = require("mongoose");
const { FamilyUploadStatus } = require("./domainEnums");

/**
 * A photo or message a family member shares about one resident (Figma: New Upload).
 * It waits in the moderation queue and nobody but its author sees it until approved.
 */
const familyUploadSchema = new mongoose.Schema(
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
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String, default: "", trim: true },
    mediaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FamilyMedia" }],
    includeInGazette: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(FamilyUploadStatus),
      default: FamilyUploadStatus.PENDING,
    },
    rejectionReason: { type: String, default: "" },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    /** Rejected uploads disappear 30 days after rejection. */
    deleteAfter: { type: Date, default: null },
    /** Lets the app resend the same upload without creating a second one. */
    clientId: { type: String, default: null },
  },
  { timestamps: true },
);

familyUploadSchema.index({ residentId: 1, status: 1, createdAt: -1 });
familyUploadSchema.index({ branchId: 1, status: 1, createdAt: -1 });
familyUploadSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
familyUploadSchema.index({ authorId: 1, createdAt: -1 });
familyUploadSchema.index(
  { authorId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

const FamilyUpload =
  mongoose.models.FamilyUpload ||
  mongoose.model("FamilyUpload", familyUploadSchema);

module.exports = { FamilyUpload };
