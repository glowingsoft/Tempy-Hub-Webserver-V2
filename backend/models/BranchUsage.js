const mongoose = require("mongoose");

const branchUsageSchema = new mongoose.Schema(
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
      unique: true,
    },
    imageBytes: { type: Number, default: 0, min: 0 },
    imageCount: { type: Number, default: 0, min: 0 },
    fileBytes: { type: Number, default: 0, min: 0 },
    fileCount: { type: Number, default: 0, min: 0 },
    categories: { type: mongoose.Schema.Types.Mixed, default: {} },
    measuredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const BranchUsage =
  mongoose.models.BranchUsage || mongoose.model("BranchUsage", branchUsageSchema);

module.exports = { BranchUsage };
