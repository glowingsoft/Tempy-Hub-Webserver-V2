const mongoose = require("mongoose");
const { BranchStatus } = require("./domainEnums");
const { nameKeyOf } = require("../helperUtils/nameKey");

const branchSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    /** Case- and spacing-insensitive form of `name`; see the unique index below. */
    nameKey: { type: String, default: undefined },
    /** Owner-entered site code: exactly 6 letters and numbers, unique. */
    code: { type: String, required: true, trim: true, unique: true, uppercase: true },
    address: { type: mongoose.Schema.Types.Mixed, default: null },
    timezone: { type: String, default: "Europe/London" },
    status: {
      type: String,
      enum: Object.values(BranchStatus),
      default: BranchStatus.ACTIVE,
    },
    emergencyPinHash: { type: String, default: "" },
    assemblyPoint: { type: String, default: "" },
    settings: {
      enableBreaks: { type: Boolean, default: false },
      lateGraceMinutes: { type: Number, default: 5, min: 0 },
      /** Allows staff to clock in from their phone instead of a kiosk. */
      allowPhoneCheckIn: { type: Boolean, default: false },
      /** If true, break time is paid (not deducted). If false, unpaid bands apply. */
      paidBreaks: { type: Boolean, default: false },
      /** When false, staff on this site cannot submit leave requests. */
      enableLeaveRequests: { type: Boolean, default: true },
      /** Hours after rostered shift.endsAt before an open session is closed. */
      autoClockOutHoursAfterShiftEnd: { type: Number, default: 3, min: 0 },
      /** Hours after clockInAt before an unscheduled open session is closed. */
      autoClockOutHoursAfterClockIn: { type: Number, default: 10, min: 0 },
      /** Hours after invitation.visitingUntil before an open visit is closed. */
      visitorAutoCheckoutHoursAfterVisitUntil: {
        type: Number,
        default: 1,
        min: 0,
      },
      /** Hours after visit checkInAt when there is no visit window. */
      visitorAutoCheckoutHoursAfterCheckIn: {
        type: Number,
        default: 10,
        min: 0,
      },
      /**
       * Unpaid break bands, e.g. 6h shift → 0.5h, 12h → 1h.
       * Longest matching minShiftHours wins.
       */
      breakBands: {
        type: [
          {
            minShiftHours: { type: Number, required: true, min: 0 },
            unpaidBreakHours: { type: Number, required: true, min: 0 },
          },
        ],
        default: undefined,
      },
    },
    activatedAt: { type: Date, default: null },
    /** Site manager responsible for this branch; set at creation or via PATCH. */
    managerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

branchSchema.pre("save", function setNameKey(next) {
  if (this.isModified("name")) this.nameKey = nameKeyOf(this.name);
  next();
});

branchSchema.index({ organizationId: 1, code: 1 }, { unique: true });

/**
 * Scoped to the organization — two care groups may each have a "Main entrance".
 * Partial so the index can be built before existing rows are backfilled.
 */
branchSchema.index(
  { organizationId: 1, nameKey: 1 },
  { unique: true, partialFilterExpression: { nameKey: { $type: "string" } } }
);

const Branch = mongoose.models.Branch || mongoose.model("Branch", branchSchema);

module.exports = { Branch };
