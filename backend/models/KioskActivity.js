const mongoose = require("mongoose");
const { KioskActivityType } = require("./domainEnums");

/** One check-in or check-out made on a kiosk, for the Kiosks screen. */
const kioskActivitySchema = new mongoose.Schema(
  {
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(KioskActivityType),
      required: true,
    },
    name: { type: String, default: "", trim: true },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: false },
);

kioskActivitySchema.index({ kioskId: 1, occurredAt: -1 });

const KioskActivity =
  mongoose.models.KioskActivity ||
  mongoose.model("KioskActivity", kioskActivitySchema);

module.exports = { KioskActivity };
