const mongoose = require("mongoose");
const validator = require("validator");
const {
  AuthAudience,
  ExternalPersonType,
  VisitorAccountInvitationStatus,
} = require("./domainEnums");

const ACCOUNT_TYPES = [
  ExternalPersonType.VISITOR,
  ExternalPersonType.CONTRACTOR,
];

const RESIDENT_ACCOUNT_TYPE = AuthAudience.RESIDENT;

/**
 * An invitation to create a visitor-app login.
 * Separate from `Invitation`, which is a timed visit and a 6-digit kiosk code.
 */
const visitorAccountInvitationSchema = new mongoose.Schema(
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
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (value) => validator.isEmail(value),
        message: "email_invalid",
      },
    },
    name: { type: String, default: "" },
    personType: {
      type: String,
      enum: [...ACCOUNT_TYPES, RESIDENT_ACCOUNT_TYPE],
      required: true,
    },
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
    },
    tokenHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: Object.values(VisitorAccountInvitationStatus),
      default: VisitorAccountInvitationStatus.PENDING,
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
    externalPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPerson",
      default: null,
    },
    lastSentAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

visitorAccountInvitationSchema.index(
  { branchId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: VisitorAccountInvitationStatus.PENDING },
  },
);
visitorAccountInvitationSchema.index({ tokenHash: 1 }, { unique: true });
visitorAccountInvitationSchema.index(
  { residentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      personType: RESIDENT_ACCOUNT_TYPE,
      status: VisitorAccountInvitationStatus.PENDING,
    },
  },
);

const VisitorAccountInvitation =
  mongoose.models.VisitorAccountInvitation ||
  mongoose.model("VisitorAccountInvitation", visitorAccountInvitationSchema);

module.exports = {
  VisitorAccountInvitation,
  ACCOUNT_TYPES,
  RESIDENT_ACCOUNT_TYPE,
};
