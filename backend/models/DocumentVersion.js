const mongoose = require("mongoose");

const storedFileSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    originalName: { type: String, default: "", trim: true },
    mimeType: { type: String, default: "", trim: true },
    sizeBytes: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const documentVersionSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    version: { type: Number, required: true, min: 1 },
    file: { type: storedFileSchema, required: true },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

documentVersionSchema.index({ documentId: 1, version: 1 }, { unique: true });

const DocumentVersion =
  mongoose.models.DocumentVersion ||
  mongoose.model("DocumentVersion", documentVersionSchema);

module.exports = { DocumentVersion };
