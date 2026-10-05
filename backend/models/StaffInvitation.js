const mongoose = require("mongoose");
const validator = require("validator");
const {
  MembershipRole,
  StaffInvitationStatus,
} = require("./domainEnums");

/**
 * An invitation for a person to join an organization as staff.
 *
 * Separate from `Invitation`, which models a visitor arriving at a site: that
 * carries arrival windows and badge types, and none of a role, branch, or
 * permission set. Overloading one model would leave most fields null on both.
 */
const staffInvitationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    /** Required for siteManager / lineManager / staff; null for an owner. */
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    email: {
      type: String,
      required: [true, "email_required"],
      trim: true,
      lowercase: true,
      // Same rule as User.email: an invitation must be deliverable to an
      // address that can later become an account.
      validate: {
        validator: (value) => validator.isEmail(value),
        message: "email_invalid",
      },
    },
    name: { type: String, default: "" },
    role: {
      type: String,
      enum: Object.values(MembershipRole),
      required: true,
    },
    permissions: { type: [String], default: [] },
    /** Applied when the invitee accepts — provisions a StaffProfile in the same transaction. */
    jobTitleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobTitle",
      default: null,
    },
    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
      },
    ],
    reportsToStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
    },
    startDate: { type: Date, default: null },
    employeeCode: { type: String, trim: true, default: null },
    /** When true, accepting this invite sets Branch.managerUserId for branchId. */
    isBranchManager: { type: Boolean, default: false },
    /**
     * Only the hash is stored, so a leaked database row cannot be redeemed.
     * The plaintext is shown once at issue and mailed to the invitee.
     */
    tokenHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: Object.values(StaffInvitationStatus),
      default: StaffInvitationStatus.PENDING,
      index: true,
    },
    expiresAt: { type: Date, required: true },
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    acceptedAt: { type: Date, default: null },
    acceptedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    revokedAt: { type: Date, default: null },
    revokedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastSentAt: { type: Date, default: null },
    sendCount: { type: Number, default: 1 },
  },
  { timestamps: true }
);

/** At most one outstanding invitation per person per organization. */
staffInvitationSchema.index(
  { organizationId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: StaffInvitationStatus.PENDING },
  }
);

const StaffInvitation =
  mongoose.models.StaffInvitation ||
  mongoose.model("StaffInvitation", staffInvitationSchema);

module.exports = { StaffInvitation };
