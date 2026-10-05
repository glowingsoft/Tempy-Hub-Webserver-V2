const mongoose = require("mongoose");
const { ComplianceRecordStatus } = require("./domainEnums");

const appraisalRecordSchema = new mongoose.Schema(
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

const AppraisalRecord =
  mongoose.models.AppraisalRecord ||
  mongoose.model("AppraisalRecord", appraisalRecordSchema);

module.exports = { AppraisalRecord };
