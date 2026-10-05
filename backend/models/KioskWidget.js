const mongoose = require("mongoose");

const kioskWidgetSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    type: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const KioskWidget =
  mongoose.models.KioskWidget ||
  mongoose.model("KioskWidget", kioskWidgetSchema);

module.exports = { KioskWidget };
