const mongoose = require("mongoose");

const SETTINGS_KEY = "default";

const platformBillingSchema = new mongoose.Schema(
  {
    key: { type: String, default: SETTINGS_KEY, unique: true },
    /** Storage every organization's plan includes, in GB; empty until the platform operator sets it. */
    planLimitGb: { type: Number, default: null, min: 0 },
    baseTierGbp: { type: Number, default: 380, min: 0 },
    overageGbpPerGb: { type: Number, default: 0.15, min: 0 },
  },
  { timestamps: true },
);

const PlatformBilling =
  mongoose.models.PlatformBilling ||
  mongoose.model("PlatformBilling", platformBillingSchema);

module.exports = { PlatformBilling, SETTINGS_KEY };
