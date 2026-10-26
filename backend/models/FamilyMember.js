const mongoose = require("mongoose");
const {
  FamilyMemberStatus,
  FamilyRelationship,
  FamilyJoinSource,
} = require("./domainEnums");

/** Links a user to one resident; read live on every request, so removal ends access at once. */
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
    /** Access paused by staff; they can switch it back on. */
    inactiveBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    inactiveAt: { type: Date, default: null },
  },
  { timestamps: true }
);

familyMemberSchema.index({ userId: 1, residentId: 1 }, { unique: true });

familyMemberSchema.index({ userId: 1, status: 1 });

familyMemberSchema.index({ residentId: 1, status: 1 });

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
