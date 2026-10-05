const mongoose = require("mongoose");
const { PeepConsentStatus } = require("./domainEnums");

const peepRecordSchema = new mongoose.Schema(
  {
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
      unique: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    reviewDueAt: { type: Date, required: true },
    lastReviewedAt: { type: Date, default: null },
    consentStatus: {
      type: String,
      enum: Object.values(PeepConsentStatus),
      required: true,
    },
    mcaBestInterestNotes: { type: String, default: "" },
    mobilityNotes: { type: String, default: "" },
    assistanceRequired: { type: String, default: "" },
    evacuationStrategy: { type: String, default: "" },
  },
  { timestamps: true }
);

const PeepRecord =
  mongoose.models.PeepRecord || mongoose.model("PeepRecord", peepRecordSchema);

module.exports = { PeepRecord };
