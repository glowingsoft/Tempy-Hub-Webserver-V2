const mongoose = require("mongoose");

const organizationUsageSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
    },
    imageBytes: { type: Number, default: 0, min: 0 },
    imageCount: { type: Number, default: 0, min: 0 },
    fileBytes: { type: Number, default: 0, min: 0 },
    fileCount: { type: Number, default: 0, min: 0 },
    /** Files that could not be measured on the last run, so the totals may be a little low. */
    unmeasured: { type: Number, default: 0, min: 0 },
    categories: { type: mongoose.Schema.Types.Mixed, default: {} },
    version: { type: Number, default: 0 },
    measuredAt: { type: Date, default: null },
    /** Set while a measurement runs, so two never run at once. */
    measuringSince: { type: Date, default: null },
  },
  { timestamps: true },
);

const OrganizationUsage =
  mongoose.models.OrganizationUsage ||
  mongoose.model("OrganizationUsage", organizationUsageSchema);

module.exports = { OrganizationUsage };
