const mongoose = require("mongoose");
const { ComplianceMeetingStatus } = require("./domainEnums");

const actionPointSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    signedOffAt: { type: Date, default: null },
    signedOffByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: false }
);

const fileSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    fileType: { type: String, default: "", trim: true },
    url: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const supervisionRecordSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
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
    scheduledAt: { type: Date, default: null },
    locationLabel: { type: String, default: "", trim: true },
    completedAt: { type: Date, default: null },
    conductedByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
    },
    /** Logged-in user who booked or completed this meeting (LM, SM, or Owner). */
    conductedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    topics: { type: [String], default: [] },
    notes: { type: String, default: "" },
    actionPoints: { type: [actionPointSchema], default: [] },
    file: { type: fileSchema, default: null },
    status: {
      type: String,
      enum: Object.values(ComplianceMeetingStatus),
      default: ComplianceMeetingStatus.SCHEDULED,
    },
  },
  { timestamps: true }
);

supervisionRecordSchema.index({ organizationId: 1, staffId: 1, completedAt: -1 });
supervisionRecordSchema.index({ organizationId: 1, branchId: 1, status: 1 });

const SupervisionRecord =
  mongoose.models.SupervisionRecord ||
  mongoose.model("SupervisionRecord", supervisionRecordSchema);

module.exports = { SupervisionRecord };
