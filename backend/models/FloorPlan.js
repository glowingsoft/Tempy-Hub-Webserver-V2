const mongoose = require("mongoose");

const floorPlanSchema = new mongoose.Schema(
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
    /** Floor label, e.g. "Ground Floor". */
    name: { type: String, required: true, trim: true },
    /** Rendered plan image. Empty until an image is uploaded. */
    imageUrl: { type: String, default: "" },
    /** Source PDF. A plan is uploaded when imageUrl or pdfUrl is set. */
    pdfUrl: { type: String, default: "" },
    /** Bumped when the image or PDF is replaced. */
    version: { type: Number, default: 0, min: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

floorPlanSchema.index({ organizationId: 1, branchId: 1, name: 1 }, { unique: true });

const FloorPlan =
  mongoose.models.FloorPlan || mongoose.model("FloorPlan", floorPlanSchema);

module.exports = { FloorPlan };
