const mongoose = require("mongoose");

/**
 * A wall post one family member saved for themselves, like a bookmark. It is not the staff pin
 * (FamilyPost.isPinned), which lifts a post to the top for everyone. One per person per post,
 * so a retry can never save it twice.
 */
const familyPostPinSchema = new mongoose.Schema(
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
  },
  { timestamps: true },
);

familyPostPinSchema.index({ postId: 1, userId: 1 }, { unique: true });
familyPostPinSchema.index({ userId: 1, createdAt: -1 });

const FamilyPostPin =
  mongoose.models.FamilyPostPin ||
  mongoose.model("FamilyPostPin", familyPostPinSchema);

module.exports = { FamilyPostPin };
