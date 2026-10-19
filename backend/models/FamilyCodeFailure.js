const mongoose = require("mongoose");

const FAMILY_CODE_LOCK_MINUTES = 15;

/** One row per wrong or expired code a member typed; rows delete themselves after the lock window. */
const familyCodeFailureSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

familyCodeFailureSchema.index({ userId: 1, createdAt: 1 });
familyCodeFailureSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: FAMILY_CODE_LOCK_MINUTES * 60 }
);

const FamilyCodeFailure =
  mongoose.models.FamilyCodeFailure ||
  mongoose.model("FamilyCodeFailure", familyCodeFailureSchema);

module.exports = { FamilyCodeFailure, FAMILY_CODE_LOCK_MINUTES };
