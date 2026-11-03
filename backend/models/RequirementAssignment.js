const mongoose = require("mongoose");
const { RequirementAssignmentSource } = require("./domainEnums");

const requirementAssignmentSchema = new mongoose.Schema(
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
    assignedAt: { type: Date, required: true },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    source: {
      type: String,
      enum: Object.values(RequirementAssignmentSource),
      required: true,
    },
    dueDate: { type: Date, required: true },
    renewalMonthsOverride: { type: Number, default: null, min: 1 },
  },
  { timestamps: true }
);

requirementAssignmentSchema.index(
  { organizationId: 1, staffId: 1, requirementId: 1 },
  { unique: true }
);
requirementAssignmentSchema.index({ organizationId: 1, requirementId: 1 });

const RequirementAssignment =
  mongoose.models.RequirementAssignment ||
  mongoose.model("RequirementAssignment", requirementAssignmentSchema);

module.exports = { RequirementAssignment };
