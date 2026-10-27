const mongoose = require("mongoose");
const { RequirementType } = require("./domainEnums");

const requirementSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(RequirementType),
      required: true,
      index: true,
    },
    renewalMonths: { type: Number, required: true, min: 1 },
    firstCompletionDays: { type: Number, required: true, min: 0 },
    amberDaysOverride: { type: Number, default: null, min: 1 },
    evidenceRequired: { type: Boolean, default: false },
    staffEvidenceAllowed: { type: Boolean, default: false },
    appliesTo: {
      jobTitleIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "JobTitle" }],
        default: [],
      },
      departmentIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
        default: [],
      },
    },
  },
  { timestamps: true }
);

requirementSchema.index({ organizationId: 1, type: 1, name: 1 });
requirementSchema.index({ organizationId: 1, branchId: 1, type: 1 });

const Requirement =
  mongoose.models.Requirement || mongoose.model("Requirement", requirementSchema);

module.exports = { Requirement };
