const mongoose = require("mongoose");
const { VisitRequestStatus } = require("./domainEnums");

const visitRequestSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
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
    requestedStartAt: { type: Date, required: true },
    requestedEndAt: { type: Date, required: true },
    partySize: { type: Number, default: 1, min: 1 },
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(VisitRequestStatus),
      default: VisitRequestStatus.PENDING,
      index: true,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "" },
    /** Populated once an approved request is turned into an invitation. */
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invitation",
      default: null,
    },
  },
  { timestamps: true }
);

visitRequestSchema.index({ branchId: 1, status: 1, requestedStartAt: -1 });

const VisitRequest =
  mongoose.models.VisitRequest ||
  mongoose.model("VisitRequest", visitRequestSchema);

module.exports = { VisitRequest };
