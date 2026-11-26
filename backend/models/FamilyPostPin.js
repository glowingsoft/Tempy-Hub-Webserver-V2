const mongoose = require("mongoose");

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
