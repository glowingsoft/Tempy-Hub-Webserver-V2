const mongoose = require("mongoose");
const { KioskPairingStatus } = require("./domainEnums");

const kioskPairingSessionSchema = new mongoose.Schema(
  {
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
    },
    scanToken: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(KioskPairingStatus),
      default: KioskPairingStatus.PENDING_CONFIRMATION,
    },
    expiresAt: { type: Date, required: true, index: true },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

kioskPairingSessionSchema.index({ kioskId: 1, status: 1, expiresAt: -1 });

const KioskPairingSession =
  mongoose.models.KioskPairingSession ||
  mongoose.model("KioskPairingSession", kioskPairingSessionSchema);

module.exports = { KioskPairingSession };
