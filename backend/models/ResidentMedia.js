const mongoose = require("mongoose");
const {
  ResidentMediaType,
  ResidentMediaReviewStatus,
} = require("./domainEnums");

const residentMediaSchema = new mongoose.Schema(
  {
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    mediaType: {
      type: String,
      enum: Object.values(ResidentMediaType),
      default: ResidentMediaType.PHOTO,
    },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: "" },
    caption: { type: String, default: "" },
    takenAt: { type: Date, default: null },
    /** Photography consent is re-checked at upload time, not inherited. */
    consentVerified: { type: Boolean, default: false },
    reviewStatus: {
      type: String,
      enum: Object.values(ResidentMediaReviewStatus),
      default: ResidentMediaReviewStatus.PENDING,
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewReason: { type: String, default: "" },
    /** Controls whether linked family members see this item in the resident app. */
    visibleToFamily: { type: Boolean, default: true },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

residentMediaSchema.index({ residentId: 1, createdAt: -1 });
residentMediaSchema.index({ branchId: 1, reviewStatus: 1, createdAt: -1 });

const ResidentMedia =
  mongoose.models.ResidentMedia ||
  mongoose.model("ResidentMedia", residentMediaSchema);

module.exports = { ResidentMedia };
