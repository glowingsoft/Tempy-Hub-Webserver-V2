const mongoose = require("mongoose");
const { KioskSetupStatus, KioskMode, KioskDeviceType } = require("./domainEnums");

const kioskSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    deviceId: { type: String, trim: true },
    receptionIdentifier: { type: String, default: "" },
    locationLabel: { type: String, default: "" },
    deviceType: {
      type: String,
      enum: Object.values(KioskDeviceType),
    },
    adminPinHash: { type: String },
    setupStatus: {
      type: String,
      enum: Object.values(KioskSetupStatus),
      default: KioskSetupStatus.PENDING,
    },
    kioskMode: {
      type: String,
      enum: Object.values(KioskMode),
      default: KioskMode.SETUP,
    },
    scanToken: { type: String },
    scanTokenExpiresAt: { type: Date },
    nfcTagId: { type: String },
    lastHeartbeatAt: { type: Date },
    lastCheckInAt: { type: Date },
  },
  { timestamps: true }
);

kioskSchema.index({ deviceId: 1 }, { unique: true, sparse: true });
kioskSchema.index({ scanToken: 1 }, { unique: true, sparse: true });
kioskSchema.index({ nfcTagId: 1 }, { unique: true, sparse: true });

const Kiosk = mongoose.models.Kiosk || mongoose.model("Kiosk", kioskSchema);

module.exports = { Kiosk };
