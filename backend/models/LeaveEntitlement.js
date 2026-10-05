const mongoose = require("mongoose");
const { LeaveType } = require("./domainEnums");

const leaveEntitlementSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    /** Leave year label, e.g. "2026-2027". */
    year: { type: String, required: true, trim: true },
    leaveType: {
      type: String,
      enum: Object.values(LeaveType),
      default: LeaveType.ANNUAL,
    },
    entitlementDays: { type: Number, required: true, min: 0 },
    carriedOverDays: { type: Number, default: 0, min: 0 },
    takenDays: { type: Number, default: 0, min: 0 },
    /** Approved but not yet taken, held back from the remaining balance. */
    pendingDays: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

leaveEntitlementSchema.index(
  { staffId: 1, year: 1, leaveType: 1 },
  { unique: true }
);

const LeaveEntitlement =
  mongoose.models.LeaveEntitlement ||
  mongoose.model("LeaveEntitlement", leaveEntitlementSchema);

module.exports = { LeaveEntitlement };
