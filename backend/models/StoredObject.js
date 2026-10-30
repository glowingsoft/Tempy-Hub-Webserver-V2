const mongoose = require("mongoose");

const storedObjectSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    size: { type: Number, default: 0, min: 0 },
    missing: { type: Boolean, default: false },
    measuredAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

const StoredObject =
  mongoose.models.StoredObject ||
  mongoose.model("StoredObject", storedObjectSchema);

module.exports = { StoredObject };
