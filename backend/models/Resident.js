const mongoose = require("mongoose");
const { AdmissionStatus, CareLevel } = require("./domainEnums");

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
  },
  { timestamps: true }
);

residentSchema.index({ qrToken: 1 }, { unique: true, sparse: true });
residentSchema.index({ userId: 1 }, { sparse: true });
residentSchema.index({ organizationId: 1, branchId: 1, createdAt: -1 });

const Resident =
  mongoose.models.Resident || mongoose.model("Resident", residentSchema);

module.exports = { Resident };
