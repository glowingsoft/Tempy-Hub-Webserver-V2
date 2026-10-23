const mongoose = require("mongoose");

/**
 * One photo a family member uploaded. `uploadId` stays null until the photo is attached to an
 * upload. Only the blurred copy is ever shown to anyone but the author; the original is kept for audit.
 */
const familyMediaSchema = new mongoose.Schema(
  {
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FamilyPost",
      default: null,
    },
    uploadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FamilyUpload",
      default: null,
    },
    storageKey: { type: String, required: true },
    url: { type: String, required: true },
    blurredKey: { type: String, default: "" },
    blurredUrl: { type: String, default: "" },
    mimeType: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    size: { type: Number, default: 0 },
  },
  { timestamps: true }
);

familyMediaSchema.index({ uploadedBy: 1, uploadId: 1 });
familyMediaSchema.index({ uploadId: 1 });
familyMediaSchema.index({ postId: 1 });

const FamilyMedia =
  mongoose.models.FamilyMedia || mongoose.model("FamilyMedia", familyMediaSchema);

module.exports = { FamilyMedia };
