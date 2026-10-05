const mongoose = require("mongoose");
const {
  CheckInMethod,
  PunctualityStatus,
  PresenceStatus,
} = require("./domainEnums");

const breakSegmentSchema = new mongoose.Schema(
  {
    breakInAt: { type: Date, required: true },
    breakOutAt: { type: Date, default: null },
  },
  { _id: false }
);

const attendanceDaySchema = new mongoose.Schema(
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
    workDate: { type: Date, required: true },
    clockInAt: { type: Date, required: true },
    clockOutAt: { type: Date, default: null },
    breaks: { type: [breakSegmentSchema], default: [] },
    checkInMethod: {
      type: String,
      enum: Object.values(CheckInMethod),
      default: CheckInMethod.KIOSK,
    },
    punctualityStatus: {
      type: String,
      enum: Object.values(PunctualityStatus),
      default: PunctualityStatus.ON_TIME,
    },
    presenceStatus: {
      type: String,
      enum: Object.values(PresenceStatus),
      default: PresenceStatus.ON_SITE,
    },
    workedMinutes: { type: Number, default: null },
    /** Idempotency key supplied by offline clients so replayed events are dropped. */
    clientEventId: { type: String, default: null },
    /** When the event happened on the device, which can predate the server write. */
    occurredAt: { type: Date, default: null },
    geo: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracy: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

attendanceDaySchema.index({ staffId: 1, workDate: 1 }, { unique: true });
attendanceDaySchema.index({ clientEventId: 1 }, { unique: true, sparse: true });

const AttendanceDay =
  mongoose.models.AttendanceDay ||
  mongoose.model("AttendanceDay", attendanceDaySchema);

module.exports = { AttendanceDay };
