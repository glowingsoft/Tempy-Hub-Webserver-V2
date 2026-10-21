const mongoose = require("mongoose");
const { StaffProfileStatus } = require("./domainEnums");

const staffProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
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
    employeeCode: { type: String, required: true, trim: true },
    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
      },
    ],
    jobTitleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobTitle",
      required: true,
    },
    reportsToStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
      index: true,
    },
    /** Who runs this person's supervision. Null until a site manager picks one. */
    supervisorStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      default: null,
      index: true,
    },
    /** Null uses the organisation default interval. */
    supervisionIntervalMonths: { type: Number, default: null, min: 1 },
    /** Null uses the organisation default appraisal interval. */
    appraisalIntervalMonths: { type: Number, default: null, min: 1 },
    startDate: { type: Date, required: true },
    /** Weekly contracted hours; used for holiday pro-rata (full-time default 37.5). */
    contractedWeeklyHours: { type: Number, default: 37.5, min: 0 },
    phone: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    bannerUrl: { type: String, default: "" },
    qrToken: { type: String, required: true, unique: true },
    /** Omitted until a tag is assigned — do not store null (breaks sparse unique). */
    nfcTagId: { type: String, trim: true },
    pinHash: { type: String, default: "" },
    ward: { type: String, default: "" },
    locationLabel: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(StaffProfileStatus),
      default: StaffProfileStatus.ACTIVE,
    },
    indicators: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

staffProfileSchema.pre("validate", function clearEmptyNfcTag(next) {
  if (this.nfcTagId == null || String(this.nfcTagId).trim() === "") {
    this.nfcTagId = undefined;
  }
  next();
});

/** One employment record per person per organization (multi-org bank staff). */
staffProfileSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
staffProfileSchema.index({ organizationId: 1, employeeCode: 1 }, { unique: true });
staffProfileSchema.index(
  { nfcTagId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      nfcTagId: { $exists: true, $type: "string", $gt: "" },
    },
  }
);

const StaffProfile =
  mongoose.models.StaffProfile ||
  mongoose.model("StaffProfile", staffProfileSchema);

module.exports = { StaffProfile };
