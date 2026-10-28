const mongoose = require("mongoose");
const { FamilyPostAudience, FamilyPostStatus } = require("./domainEnums");

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
    title: { type: String, default: "", trim: true },
    message: { type: String, default: "", trim: true },
    mediaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FamilyMedia" }],
    taggedResidentIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Resident" },
    ],
    /** all: every family in the organization; branch: the families at this site; tagged: only the families of the tagged residents. */
    audience: {
      type: String,
      enum: Object.values(FamilyPostAudience),
      default: FamilyPostAudience.BRANCH,
    },
    isPinned: { type: Boolean, default: false },
    /** When a scheduled post goes live. createdAt moves to that moment, so it reads as posted then. */
    scheduledAt: { type: Date, default: null },
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
  { timestamps: true },
);

familyPostSchema.index({
  organizationId: 1,
  branchId: 1,
  status: 1,
  isPinned: -1,
  createdAt: -1,
});
familyPostSchema.index({ taggedResidentIds: 1, status: 1, createdAt: -1 });
familyPostSchema.index({ status: 1, scheduledAt: 1 });

const FamilyPost =
  mongoose.models.FamilyPost || mongoose.model("FamilyPost", familyPostSchema);

module.exports = { FamilyPost };
