const mongoose = require("mongoose");
const { ActiveInactiveStatus, FamilyRelationship } = require("./domainEnums");

/**
 * Links a login (User) to one resident. This is what makes an account a
 * "family" account: the family audience requires at least one active row.
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
      index: true,
    },
    relationship: {
      type: String,
      enum: Object.values(FamilyRelationship),
      default: FamilyRelationship.OTHER,
    },
    isPrimaryContact: { type: Boolean, default: false },
    phone: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(ActiveInactiveStatus),
      default: ActiveInactiveStatus.ACTIVE,
    },
  },
  { timestamps: true }
);

/** One link per person per resident; a relative of two residents has two rows. */
familyMemberSchema.index({ userId: 1, residentId: 1 }, { unique: true });

const FamilyMember =
  mongoose.models.FamilyMember ||
  mongoose.model("FamilyMember", familyMemberSchema);

module.exports = { FamilyMember };
