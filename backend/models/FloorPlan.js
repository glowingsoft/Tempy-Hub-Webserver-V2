const mongoose = require("mongoose");

const floorPlanSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    imageUrl: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const FloorPlan =
  mongoose.models.FloorPlan || mongoose.model("FloorPlan", floorPlanSchema);

module.exports = { FloorPlan };
