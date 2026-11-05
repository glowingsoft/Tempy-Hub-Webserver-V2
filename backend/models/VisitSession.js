const mongoose = require("mongoose");
const {
  ExternalPersonType,
  VisitMethod,
  VisitSessionStatus,
} = require("./domainEnums");

const policySignedSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    signedAt: { type: Date, required: true },
    signatureUrl: { type: String, default: "" },
  },
  { _id: false }
);

const visitSessionSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    externalPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPerson",
      default: null,
      index: true,
    },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invitation",
      default: null,
    },
    personType: {
      type: String,
      enum: Object.values(ExternalPersonType),
      required: true,
    },
    method: {
      type: String,
      enum: Object.values(VisitMethod),
      required: true,
    },
    hostStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
    },
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      default: null,
      index: true,
    },
    hostName: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(VisitSessionStatus),
      default: VisitSessionStatus.ON_SITE,
      index: true,
    },
    purposeOfVisit: { type: String, default: "" },
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
      default: null,
    },
    /** When they presented at the kiosk, which precedes approval for walk-ins. */
    arrivedAt: { type: Date, default: null },
    checkInAt: { type: Date, default: null },
    checkOutAt: { type: Date, default: null },
    /** True when closed by auto-checkout, not a kiosk/staff punch. */
    autoClosed: { type: Boolean, default: false },
    /** Set when the resident requires a visitor passcode and it was verified. */
    residentPasscodeVerified: { type: Boolean, default: false },
    residentPasscodeVerifiedAt: { type: Date, default: null },
    policiesSigned: { type: [policySignedSchema], default: [] },
  },
  { timestamps: true }
);

visitSessionSchema.index({ branchId: 1, status: 1, checkOutAt: 1 });
visitSessionSchema.index({ status: 1, checkOutAt: 1, checkInAt: 1 });
visitSessionSchema.index({ branchId: 1, personType: 1, checkInAt: -1 });
visitSessionSchema.index({
  branchId: 1,
  externalPersonId: 1,
  status: 1,
  checkOutAt: 1,
});

const VisitSession =
  mongoose.models.VisitSession ||
  mongoose.model("VisitSession", visitSessionSchema);

module.exports = { VisitSession };
