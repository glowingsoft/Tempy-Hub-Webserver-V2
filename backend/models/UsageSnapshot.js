const mongoose = require("mongoose");

const usageSnapshotSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true },
    imageBytes: { type: Number, default: 0, min: 0 },
    fileBytes: { type: Number, default: 0, min: 0 },
    organizations: { type: Number, default: 0, min: 0 },
    capturedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const UsageSnapshot =
  mongoose.models.UsageSnapshot ||
  mongoose.model("UsageSnapshot", usageSnapshotSchema);

module.exports = { UsageSnapshot };
