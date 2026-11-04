const mongoose = require("mongoose");
const { ShiftStatus, ShiftVisibility } = require("./domainEnums");

/** Minimal rota stub — expand after Rota UI. */
const shiftSchema = new mongoose.Schema(
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
    /** Null while the shift is open for claims. */
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
      index: true,
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(ShiftStatus),
      default: ShiftStatus.SCHEDULED,
    },
    /**
     * `organization` advertises the shift to staff at sibling branches, for
     * groups that share cover across sites.
     */
    visibility: {
      type: String,
      enum: Object.values(ShiftVisibility),
      default: ShiftVisibility.BRANCH,
    },
    /** Raises the shift in staff apps as needing cover. */
    urgentCover: { type: Boolean, default: false },
    openedAt: { type: Date, default: null },
    filledAt: { type: Date, default: null },
    filledByClaimId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShiftClaim",
      default: null,
    },
  },
  { timestamps: true }
);

shiftSchema.index({ branchId: 1, startsAt: 1 });
shiftSchema.index({ branchId: 1, staffId: 1, startsAt: 1 });
shiftSchema.index({ organizationId: 1, status: 1, visibility: 1, startsAt: 1 });

const Shift = mongoose.models.Shift || mongoose.model("Shift", shiftSchema);

module.exports = { Shift };
