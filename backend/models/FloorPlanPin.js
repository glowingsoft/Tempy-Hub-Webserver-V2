const mongoose = require("mongoose");

const floorPlanPinSchema = new mongoose.Schema(
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
    floorPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FloorPlan",
      required: true,
      index: true,
    },
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
      index: true,
    },
    /** Fraction of plan width (0–1). */
    x: { type: Number, required: true, min: 0, max: 1 },
    /** Fraction of plan height (0–1). */
    y: { type: Number, required: true, min: 0, max: 1 },
  },
  { timestamps: true }
);

floorPlanPinSchema.index({ floorPlanId: 1, residentId: 1 }, { unique: true });

const FloorPlanPin =
  mongoose.models.FloorPlanPin ||
  mongoose.model("FloorPlanPin", floorPlanPinSchema);

module.exports = { FloorPlanPin };
