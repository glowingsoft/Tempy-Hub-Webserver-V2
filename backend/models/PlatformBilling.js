const mongoose = require("mongoose");

const SETTINGS_KEY = "default";

/** The platform's prices, one document for everyone. */
const platformBillingSchema = new mongoose.Schema(
  {
    key: { type: String, default: SETTINGS_KEY, unique: true },
    baseTierGbp: { type: Number, default: 380, min: 0 },
    overageGbpPerGb: { type: Number, default: 0.15, min: 0 },
  },
  { timestamps: true },
);

const PlatformBilling =
  mongoose.models.PlatformBilling ||
  mongoose.model("PlatformBilling", platformBillingSchema);

module.exports = { PlatformBilling, SETTINGS_KEY };
