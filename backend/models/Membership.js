const mongoose = require("mongoose");
const { MembershipRole, ActiveInactiveStatus } = require("./domainEnums");

const membershipSchema = new mongoose.Schema(
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
    /** Required for siteManager / lineManager / staff; null for owner-wide. */
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(MembershipRole),
      required: true,
    },
    permissions: { type: [String], default: [] },
    status: {
      type: String,
      enum: Object.values(ActiveInactiveStatus),
      default: ActiveInactiveStatus.ACTIVE,
    },
  },
  { timestamps: true }
);

membershipSchema.index({ userId: 1, organizationId: 1 });
membershipSchema.index({ branchId: 1, role: 1 });

/**
 * One active membership per user per scope. Inactive rows are excluded so a
 * revoked membership can be reissued later without tripping the constraint.
 */
membershipSchema.index(
  { userId: 1, organizationId: 1, branchId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: ActiveInactiveStatus.ACTIVE },
  }
);

const Membership =
  mongoose.models.Membership || mongoose.model("Membership", membershipSchema);

module.exports = { Membership };
