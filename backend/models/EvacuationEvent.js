const mongoose = require("mongoose");
const { EvacuationType, EvacuationStatus } = require("./domainEnums");

const evacuationEventSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(EvacuationType),
      required: true,
    },
    startedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    startedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(EvacuationStatus),
      default: EvacuationStatus.ACTIVE,
    },
  },
  { timestamps: true }
);

const EvacuationEvent =
  mongoose.models.EvacuationEvent ||
  mongoose.model("EvacuationEvent", evacuationEventSchema);

module.exports = { EvacuationEvent };
