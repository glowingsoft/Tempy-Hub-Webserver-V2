const mongoose = require("mongoose");
const { FamilyPostReportStatus } = require("./domainEnums");

/** A family member flagged a wall post. The poster is never told who; staff can see. */
const familyPostReportSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "FamilyPost", required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: Object.values(FamilyPostReportStatus),
      default: FamilyPostReportStatus.OPEN,
    },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

familyPostReportSchema.index({ postId: 1, reporterId: 1 }, { unique: true });
familyPostReportSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

const FamilyPostReport =
  mongoose.models.FamilyPostReport || mongoose.model("FamilyPostReport", familyPostReportSchema);

module.exports = { FamilyPostReport };
