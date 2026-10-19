const mongoose = require("mongoose");
const {
  FamilyMemberStatus,
  FamilyRelationship,
  FamilyJoinSource,
} = require("./domainEnums");

/**
 * Links a login (User) to one resident. This is what makes an account a
 * "family" account, and it is read live on every request, so removing a member
 * ends their access at once even while their token is still valid.
 */
const familyMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
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
    },
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
    },
    relationship: {
      type: String,
      enum: Object.values(FamilyRelationship),
      default: FamilyRelationship.OTHER,
    },
    /** At most one active next of kin per resident (see the partial index below). */
    isNextOfKin: { type: Boolean, default: false },
    phone: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(FamilyMemberStatus),
      default: FamilyMemberStatus.ACTIVE,
    },
    joinedVia: {
      type: String,
      enum: Object.values(FamilyJoinSource),
      default: FamilyJoinSource.INVITATION,
    },
    /** When a code join request was made; null for invitations. */
    requestedAt: { type: Date, default: null },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    removedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    removedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/** One link per person per resident; a relative of two residents has two rows. */
familyMemberSchema.index({ userId: 1, residentId: 1 }, { unique: true });

/** Resolving "which residents can this user see" runs on every request. */
familyMemberSchema.index({ userId: 1, status: 1 });

/** Members and join requests of a resident, for My Family and the review list. */
familyMemberSchema.index({ residentId: 1, status: 1 });

/** A resident has at most one active next of kin. */
familyMemberSchema.index(
  { residentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isNextOfKin: true,
      status: FamilyMemberStatus.ACTIVE,
    },
  }
);

const FamilyMember =
  mongoose.models.FamilyMember ||
  mongoose.model("FamilyMember", familyMemberSchema);

module.exports = { FamilyMember };
