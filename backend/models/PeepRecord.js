const mongoose = require("mongoose");
const { PeepConsentStatus, CareLevel } = require("./domainEnums");

const peepRecordSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
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
    peepLevel: {
      type: String,
      enum: Object.values(CareLevel),
      required: true,
    },
    supportNeeds: { type: String, default: "" },
    primaryRoute: { type: String, default: "" },
    secondaryRoute: { type: String, default: "" },
    equipmentRequired: { type: String, default: "" },
    responsibleStaff: { type: String, default: "" },
    reviewDueAt: { type: Date, default: null },
    lastReviewedAt: { type: Date, default: null },
    consentStatus: {
      type: String,
      enum: Object.values(PeepConsentStatus),
      default: PeepConsentStatus.CONSENT,
    },
    mcaBestInterestNotes: { type: String, default: "" },
    mobilityNotes: { type: String, default: "" },
    assistanceRequired: { type: String, default: "" },
    evacuationStrategy: { type: String, default: "" },
  },
  { timestamps: true }
);

peepRecordSchema.index({ organizationId: 1, branchId: 1, peepLevel: 1 });

const PeepRecord =
  mongoose.models.PeepRecord || mongoose.model("PeepRecord", peepRecordSchema);

module.exports = { PeepRecord };
