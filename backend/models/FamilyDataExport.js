const mongoose = require("mongoose");
const { FamilyDataExportStatus } = require("./domainEnums");

/**
 * A family member's copy of their own data (Figma: Download My Data). There is one per person:
 * a new request replaces the old one and its file. `requestId` changes with every request, so
 * work or a download link belonging to an earlier request can never touch the current one.
 */
const familyDataExportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestId: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: Object.values(FamilyDataExportStatus),
      default: FamilyDataExportStatus.PREPARING,
    },
    requestedAt: { type: Date, required: true },
    preparedAt: { type: Date, default: null },
    /** When the file stops being downloadable and is deleted. */
    expiresAt: { type: Date, default: null },
    /** Never sent to a client. */
    storageKey: { type: String, default: "" },
    fileName: { type: String, default: "" },
    size: { type: Number, default: 0 },
    /** Set while one server is building the file. */
    claimedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

familyDataExportSchema.index({ userId: 1 }, { unique: true });
familyDataExportSchema.index({ requestId: 1 });
familyDataExportSchema.index({ status: 1, expiresAt: 1 });

const FamilyDataExport =
  mongoose.models.FamilyDataExport ||
  mongoose.model("FamilyDataExport", familyDataExportSchema);

module.exports = { FamilyDataExport };
