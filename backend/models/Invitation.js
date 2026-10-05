const mongoose = require("mongoose");
const { BadgeType, InvitationStatus } = require("./domainEnums");

const invitationSchema = new mongoose.Schema(
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
    /** Set when the visit is tied to a resident rather than a staff host. */
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      default: null,
    },
    visitorName: { type: String, required: true, trim: true },
    visitorEmail: { type: String, required: true, trim: true },
    hostStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
    },
    badgeType: {
      type: String,
      enum: Object.values(BadgeType),
      default: BadgeType.GUEST,
    },
    arrivalAt: { type: Date, required: true },
    visitingUntil: { type: Date, required: true },
    instructions: { type: String, default: "" },
    additionalRecipients: { type: [String], default: [] },
    expressCheckIn: { type: Boolean, default: false },
    supportingDocumentUrl: { type: String, default: "" },
    inviteCode: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: Object.values(InvitationStatus),
      default: InvitationStatus.PENDING,
    },
    guestResponseAt: { type: Date, default: null },
    visitSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VisitSession",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const Invitation =
  mongoose.models.Invitation || mongoose.model("Invitation", invitationSchema);

module.exports = { Invitation };
