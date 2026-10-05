const mongoose = require("mongoose");
const { ShiftClaimStatus } = require("./domainEnums");

/**
 * A staff member putting themselves forward for an open shift.
 *
 * Kept separate from `Shift.staffId` so a contended pickup leaves an audit
 * trail of everyone who tried, not just whoever won.
 */
const shiftClaimSchema = new mongoose.Schema(
  {
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    /** The claimant's home branch, which may differ from the shift's branch. */
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ShiftClaimStatus),
      default: ShiftClaimStatus.PENDING,
      index: true,
    },
    note: { type: String, default: "" },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "" },
    clientEventId: { type: String, default: null },
  },
  { timestamps: true }
);

/** One live claim per staff member per shift; re-claiming after withdrawing is allowed. */
shiftClaimSchema.index(
  { shiftId: 1, staffId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [ShiftClaimStatus.PENDING, ShiftClaimStatus.APPROVED] },
    },
  }
);
shiftClaimSchema.index({ clientEventId: 1 }, { unique: true, sparse: true });

const ShiftClaim =
  mongoose.models.ShiftClaim || mongoose.model("ShiftClaim", shiftClaimSchema);

module.exports = { ShiftClaim };
