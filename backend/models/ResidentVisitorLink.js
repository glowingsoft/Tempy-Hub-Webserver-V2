const mongoose = require("mongoose");
const { ActiveInactiveStatus } = require("./domainEnums");

const residentVisitorLinkSchema = new mongoose.Schema(
  {
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
      index: true,
    },
    externalPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPerson",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    relationship: { type: String, default: "" },
    /** Next of kin gets escalation notifications the other links do not. */
    isNextOfKin: { type: Boolean, default: false },
    canBookVisits: { type: Boolean, default: true },
    canViewMedia: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(ActiveInactiveStatus),
      default: ActiveInactiveStatus.ACTIVE,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

residentVisitorLinkSchema.index(
  { residentId: 1, externalPersonId: 1 },
  { unique: true }
);

const ResidentVisitorLink =
  mongoose.models.ResidentVisitorLink ||
  mongoose.model("ResidentVisitorLink", residentVisitorLinkSchema);

module.exports = { ResidentVisitorLink };
