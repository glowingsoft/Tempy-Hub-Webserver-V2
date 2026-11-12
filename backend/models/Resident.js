const mongoose = require("mongoose");
const {
  AdmissionStatus,
  CareLevel,
  ResidentDischargeReason,
} = require("./domainEnums");

const residentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    /** Set only when the resident has a login for the resident app. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    admissionStatus: {
      type: String,
      enum: Object.values(AdmissionStatus),
      default: AdmissionStatus.ADMITTED,
    },
    careLevel: {
      type: String,
      enum: Object.values(CareLevel),
    },
    roomNumber: { type: String, default: "" },
    admittedAt: { type: Date, default: null },
    /** Static QR, unlike the rotating tokens issued to visitors and contractors. */
    qrToken: { type: String, default: null },
    photographyConsent: { type: Boolean, default: false },
    photographyConsentCheckedAt: { type: Date, default: null },
    /**
     * Safeguarding: when set, a visitor or staff member must produce this
     * code before discussing or visiting the resident. Bcrypt-hashed. Never
     * projected on list/get.
     */
    visitorPasscodeRequired: { type: Boolean, default: false },
    visitorPasscodeHash: { type: String, default: null, select: false },
    visitorPasscodeSetAt: { type: Date, default: null },
    /** Visiting restriction set by the site manager. */
    restricted: { type: Boolean, default: false },
    restrictedReason: { type: String, default: "" },
    restrictedAt: { type: Date, default: null },
    restrictedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /** Currently out of the home. */
    isOut: { type: Boolean, default: false },
    outDestination: { type: String, default: "" },
    outNote: { type: String, default: "" },
    outSince: { type: Date, default: null },
    expectedReturnAt: { type: Date, default: null },
    outByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /** Filled when the site manager deactivates the resident with a reason. */
    discharge: {
      reason: {
        type: String,
        enum: [...Object.values(ResidentDischargeReason), null],
        default: null,
      },
      message: { type: String, default: "" },
      dischargedAt: { type: Date, default: null },
      dischargedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      familyAccessEndsAt: { type: Date, default: null },
      familiesNotified: { type: Number, default: 0 },
      visitsCancelled: { type: Number, default: 0 },
      visitPassesCancelled: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

residentSchema.index({ qrToken: 1 }, { unique: true, sparse: true });
residentSchema.index({ userId: 1 }, { sparse: true });
residentSchema.index({ organizationId: 1, branchId: 1, createdAt: -1 });
residentSchema.index({ branchId: 1, restricted: 1 });
residentSchema.index({ branchId: 1, isOut: 1 });

const Resident =
  mongoose.models.Resident || mongoose.model("Resident", residentSchema);

module.exports = { Resident };
