const mongoose = require("mongoose");
const { ComplianceRecordStatus } = require("./domainEnums");

const supervisionRecordSchema = new mongoose.Schema(
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

const SupervisionRecord =
  mongoose.models.SupervisionRecord ||
  mongoose.model("SupervisionRecord", supervisionRecordSchema);

module.exports = { SupervisionRecord };
