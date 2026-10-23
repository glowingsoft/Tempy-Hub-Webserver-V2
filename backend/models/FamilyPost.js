const mongoose = require("mongoose");
const { FamilyPostStatus } = require("./domainEnums");

/**
 * A staff post on the community wall (Figma: Community Wall). It goes live straight away, with
 * no approval, and every family at the site sees it; tagged residents also get it on their timeline.
 */
const familyPostSchema = new mongoose.Schema(
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
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String, default: "", trim: true },
    mediaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FamilyMedia" }],
    taggedResidentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Resident" }],
    isPinned: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(FamilyPostStatus),
      default: FamilyPostStatus.PUBLISHED,
    },
    removedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    removedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

familyPostSchema.index({ organizationId: 1, branchId: 1, status: 1, isPinned: -1, createdAt: -1 });
familyPostSchema.index({ taggedResidentIds: 1, status: 1, createdAt: -1 });

const FamilyPost =
  mongoose.models.FamilyPost || mongoose.model("FamilyPost", familyPostSchema);

module.exports = { FamilyPost };
