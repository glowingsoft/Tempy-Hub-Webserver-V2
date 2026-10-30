const mongoose = require("mongoose");

/**
 * Someone saw a wall post. One row per person per post. `residentIds` are the families they
 * belong to at that site, so "seen by 31 of 42 families" can count families, not people.
 */
const familyPostViewSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FamilyPost",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
    residentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Resident" }],
  },
  { timestamps: true },
);

familyPostViewSchema.index({ postId: 1, userId: 1 }, { unique: true });

const FamilyPostView =
  mongoose.models.FamilyPostView ||
  mongoose.model("FamilyPostView", familyPostViewSchema);

module.exports = { FamilyPostView };
