const mongoose = require("mongoose");
const { ActivationCodeStatus } = require("./domainEnums");

/**
 * Activation code = registration code (same credential).
 * Issued by Owner to Site Manager to activate / set up a branch.
 */
const branchActivationCodeSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    codeHash: { type: String, required: true },
    issuedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    issuedToUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    expiresAt: { type: Date, default: null },
    /**
     * Codes are 4 digits so they can be read out over the phone, which leaves
     * only 10,000 combinations. Entropy is not the control here — single use,
     * a short expiry, and this attempt budget are. Exhausting it locks the code.
     */
    failedAttempts: { type: Number, default: 0 },
    lockedAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
    usedByKioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
    },
    /** Pending kiosk this code binds; omitted on legacy branch-level codes. */
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
    },
    status: {
      type: String,
      enum: Object.values(ActivationCodeStatus),
      default: ActivationCodeStatus.ACTIVE,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

branchActivationCodeSchema.index({ kioskId: 1 }, { sparse: true });

const BranchActivationCode =
  mongoose.models.BranchActivationCode ||
  mongoose.model("BranchActivationCode", branchActivationCodeSchema);

module.exports = { BranchActivationCode };
