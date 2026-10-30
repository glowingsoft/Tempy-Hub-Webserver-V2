const mongoose = require("mongoose");

/** The size of one file in the bucket. Keys are random and never change, so a size is measured once. */
const storedObjectSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    size: { type: Number, default: 0, min: 0 },
    /** The bucket had no such file when it was measured. */
    missing: { type: Boolean, default: false },
    measuredAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

const StoredObject =
  mongoose.models.StoredObject ||
  mongoose.model("StoredObject", storedObjectSchema);

module.exports = { StoredObject };
