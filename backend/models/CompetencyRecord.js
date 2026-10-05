const mongoose = require("mongoose");
const { ComplianceRecordStatus } = require("./domainEnums");

const competencyRecordSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    dueAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(ComplianceRecordStatus),
      default: ComplianceRecordStatus.DUE,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

const CompetencyRecord =
  mongoose.models.CompetencyRecord ||
  mongoose.model("CompetencyRecord", competencyRecordSchema);

module.exports = { CompetencyRecord };
