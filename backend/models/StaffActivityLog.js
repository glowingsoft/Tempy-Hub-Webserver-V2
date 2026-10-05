const mongoose = require("mongoose");

const staffActivityLogSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StaffProfile",
      required: true,
      index: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const StaffActivityLog =
  mongoose.models.StaffActivityLog ||
  mongoose.model("StaffActivityLog", staffActivityLogSchema);

module.exports = { StaffActivityLog };
