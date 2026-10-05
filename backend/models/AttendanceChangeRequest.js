const mongoose = require("mongoose");
const { ChangeRequestStatus } = require("./domainEnums");

const attendanceChangeRequestSchema = new mongoose.Schema(
  {
    attendanceDayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceDay",
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: Object.values(ChangeRequestStatus),
      default: ChangeRequestStatus.PENDING,
    },
  },
  { timestamps: true }
);

const AttendanceChangeRequest =
  mongoose.models.AttendanceChangeRequest ||
  mongoose.model("AttendanceChangeRequest", attendanceChangeRequestSchema);

module.exports = { AttendanceChangeRequest };
