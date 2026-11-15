const mongoose = require("mongoose");
const {
  LeaveType,
  LeaveRequestStatus,
  LeaveRequestSource,
} = require("./domainEnums");

const leaveRequestSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
    /** Optional — leave is org-level; site is not required. */
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    leaveType: {
      type: String,
      enum: Object.values(LeaveType),
      default: LeaveType.ANNUAL,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    /** Set when staff report sickness against a rostered shift. */
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
      index: true,
    },
    /** Counted in days so half days are expressible as 0.5. */
    totalDays: { type: Number, required: true, min: 0 },
    reason: { type: String, default: "" },
    attachmentUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(LeaveRequestStatus),
      default: LeaveRequestStatus.PENDING,
      index: true,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    /** Shown to the staff member, e.g. "Cover unavailable". */
    decisionNote: { type: String, default: "" },
    source: {
      type: String,
      enum: Object.values(LeaveRequestSource),
      default: LeaveRequestSource.STAFF_REQUEST,
    },
    /**
     * Manager-recorded leave (typically sickness) is entered after the fact and
     * never passes through approval, so it carries no `decidedBy`.
     */
    recordedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ branchId: 1, status: 1, startDate: -1 });

const LeaveRequest =
  mongoose.models.LeaveRequest ||
  mongoose.model("LeaveRequest", leaveRequestSchema);

module.exports = { LeaveRequest };
