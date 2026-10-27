const mongoose = require("mongoose");

/**
 * Proof that the "gazette closes soon" reminder went out for one site's issue period. The unique index is what
 * keeps it to once: whoever inserts the row sends the reminder.
 */
const familyGazetteReminderSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true },
    periodStart: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

familyGazetteReminderSchema.index({ branchId: 1, periodStart: 1 }, { unique: true });

const FamilyGazetteReminder =
  mongoose.models.FamilyGazetteReminder || mongoose.model("FamilyGazetteReminder", familyGazetteReminderSchema);

module.exports = { FamilyGazetteReminder };
