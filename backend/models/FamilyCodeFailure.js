const mongoose = require("mongoose");

/**
 * One row per wrong or expired family code a member typed. Five rows inside the
 * lock window lock code entry for that member. Rows delete themselves after the
 * window, so nothing needs cleaning up.
 */
const FAMILY_CODE_LOCK_MINUTES = 15;

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
