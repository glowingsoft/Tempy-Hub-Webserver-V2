const mongoose = require("mongoose");

/** One tap on a wall post. One per person per post, so a retry can never count twice. */
const familyReactionSchema = new mongoose.Schema(
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
  { timestamps: true }
);

familyReactionSchema.index({ postId: 1, userId: 1 }, { unique: true });

const FamilyReaction =
  mongoose.models.FamilyReaction ||
  mongoose.model("FamilyReaction", familyReactionSchema);

module.exports = { FamilyReaction };
