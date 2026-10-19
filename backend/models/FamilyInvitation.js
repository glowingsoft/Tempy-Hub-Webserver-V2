const mongoose = require("mongoose");
const validator = require("validator");
const {
  FamilyInvitationStatus,
  FamilyRelationship,
} = require("./domainEnums");

/**
 * An invitation for a relative to get a family-app login linked to one resident.
 *
 * Separate from `StaffInvitation` (roles, permissions, employment) and from the
 * visitor `Invitation` (arrival windows, badges): none of those fields apply.
 */
const familyInvitationSchema = new mongoose.Schema(
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
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, "email_required"],
      trim: true,
      lowercase: true,
      validate: {
        validator: (value) => validator.isEmail(value),
        message: "email_invalid",
      },
    },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    relationship: {
      type: String,
      enum: Object.values(FamilyRelationship),
      default: FamilyRelationship.OTHER,
    },
    isPrimaryContact: { type: Boolean, default: false },
    /** Only the hash is stored; the plaintext is mailed once at issue. */
    tokenHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: Object.values(FamilyInvitationStatus),
      default: FamilyInvitationStatus.PENDING,
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

/** At most one outstanding invitation per person per resident. */
familyInvitationSchema.index(
  { residentId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: FamilyInvitationStatus.PENDING },
  }
);

const FamilyInvitation =
  mongoose.models.FamilyInvitation ||
  mongoose.model("FamilyInvitation", familyInvitationSchema);

module.exports = { FamilyInvitation };
