const mongoose = require("mongoose");

/**
 * What an organization decides for its family module (Figma: Family settings). One document per
 * organization; until it is saved the defaults in the settings service apply and nothing runs on a schedule.
 */
const familySettingsSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
    },
    gazette: {
      /** Days from the start of one issue to the start of the next. */
      issueEveryDays: { type: Number, default: 14 },
      /** Most family messages one resident's gazette holds. */
      messageCap: { type: Number, default: 30 },
      /** The first day of an issue; every later issue starts a whole number of cycles after it. */
      anchorDate: { type: Date, default: null },
    },
    /** Reminds families before the gazette message deadline. */
    deadlineReminder: { type: Boolean, default: true },
    /** Whether the home's families see the community wall. */
    communityWall: { type: Boolean, default: true },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const FamilySettings =
  mongoose.models.FamilySettings ||
  mongoose.model("FamilySettings", familySettingsSchema);

module.exports = { FamilySettings };
