const mongoose = require("mongoose");
const { AppraisalKind, ComplianceMeetingStatus } = require("./domainEnums");

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

const appraisalRecordSchema = new mongoose.Schema(
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
    kind: {
      type: String,
      enum: Object.values(AppraisalKind),
      default: AppraisalKind.ANNUAL,
    },
    periodLabel: { type: String, default: "", trim: true },
    scheduledAt: { type: Date, default: null },
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
    managerComments: { type: String, default: "" },
    goals: { type: String, default: "" },
    trainingNeeds: { type: String, default: "" },
    actionPoints: { type: [actionPointSchema], default: [] },
    file: { type: fileSchema, default: null },
    staffSignedAt: { type: Date, default: null },
    staffSignedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    staffSignatureUrl: { type: String, default: "" },
    siteManagerSignedAt: { type: Date, default: null },
    siteManagerSignedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    siteManagerSignatureUrl: { type: String, default: "" },
    lockedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(ComplianceMeetingStatus),
      default: ComplianceMeetingStatus.SCHEDULED,
    },
  },
  { timestamps: true }
);

appraisalRecordSchema.index({ organizationId: 1, staffId: 1, completedAt: -1 });
appraisalRecordSchema.index({ organizationId: 1, branchId: 1, status: 1 });

const AppraisalRecord =
  mongoose.models.AppraisalRecord ||
  mongoose.model("AppraisalRecord", appraisalRecordSchema);

module.exports = { AppraisalRecord };
