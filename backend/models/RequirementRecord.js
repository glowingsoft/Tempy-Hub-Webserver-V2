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

const requirementRecordSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RequirementAssignment",
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    requirementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Requirement",
      required: true,
      index: true,
    },
    completedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    documents: { type: [storedFileSchema], default: [] },
    signedOffBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

requirementRecordSchema.index({ assignmentId: 1, completedAt: -1 });
requirementRecordSchema.index({ organizationId: 1, staffId: 1, requirementId: 1 });

const RequirementRecord =
  mongoose.models.RequirementRecord ||
  mongoose.model("RequirementRecord", requirementRecordSchema);

module.exports = { RequirementRecord };
