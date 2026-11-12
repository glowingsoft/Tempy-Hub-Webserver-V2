const mongoose = require("mongoose");
const { ResidentDischargeReason } = require("./domainEnums");

/**
 * What the site manager app records about a resident beyond admission: the
 * Restricted and Out flags and the discharge details. Kept apart from Resident
 * so the resident responses the admin web already uses do not change.
 */
const residentStatusSchema = new mongoose.Schema(
  {
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
      unique: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    restricted: { type: Boolean, default: false },
    restrictedReason: { type: String, default: "" },
    restrictedAt: { type: Date, default: null },
    restrictedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isOut: { type: Boolean, default: false },
    outDestination: { type: String, default: "" },
    outNote: { type: String, default: "" },
    outSince: { type: Date, default: null },
    expectedReturnAt: { type: Date, default: null },
    outByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    discharge: {
      reason: {
        type: String,
        enum: [...Object.values(ResidentDischargeReason), null],
        default: null,
      },
      message: { type: String, default: "" },
      dischargedAt: { type: Date, default: null },
      dischargedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      familyAccessEndsAt: { type: Date, default: null },
      familiesNotified: { type: Number, default: 0 },
      visitsCancelled: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

residentStatusSchema.index({ branchId: 1, restricted: 1 });
residentStatusSchema.index({ branchId: 1, isOut: 1 });

const ResidentStatus =
  mongoose.models.ResidentStatus ||
  mongoose.model("ResidentStatus", residentStatusSchema);

module.exports = { ResidentStatus };
