const mongoose = require("mongoose");
const { StaffAssetStatus } = require("./domainEnums");

const staffAssetSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: { type: String, default: "" },
    serialNumber: { type: String, default: "" },
    assignedAt: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: Object.values(StaffAssetStatus),
      default: StaffAssetStatus.ASSIGNED,
    },
  },
  { timestamps: true }
);

const StaffAsset =
  mongoose.models.StaffAsset || mongoose.model("StaffAsset", staffAssetSchema);

module.exports = { StaffAsset };
