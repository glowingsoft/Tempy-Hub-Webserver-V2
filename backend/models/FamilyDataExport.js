const mongoose = require("mongoose");
const { FamilyDataExportStatus } = require("./domainEnums");

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
    expiresAt: { type: Date, default: null },
    storageKey: { type: String, default: "" },
    fileName: { type: String, default: "" },
    size: { type: Number, default: 0 },
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
