const mongoose = require("mongoose");
const {
  FamilyVisitStatus,
  FamilyVisitSource,
  FamilyVisitReply,
} = require("./domainEnums");

const replySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    response: {
      type: String,
      enum: Object.values(FamilyVisitReply),
      required: true,
    },
    respondedAt: { type: Date, required: true },
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invitation",
      default: null,
    },
  },
  { _id: false },
);

/**
 * A visit to one resident (Figma: My Visits, Book A Visit). A family member asks for one and the home
 * confirms it, or the home invites the family and each member answers for themselves. It is kept apart
 * from the kiosk's own visit records; a confirmed visit gets an ordinary invitation so the kiosk works as before.
 */
const familyVisitSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
    },
    source: {
      type: String,
      enum: Object.values(FamilyVisitSource),
      required: true,
    },
    /** The family member who asked; empty when the home invited the family. */
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    /** The staff member who sent a home invitation. */
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    partySize: { type: Number, default: 1, min: 1 },
    note: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: Object.values(FamilyVisitStatus),
      required: true,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "", trim: true },
    /** The invitation the kiosk checks in; set when a request is confirmed. */
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invitation",
      default: null,
    },
    /** Answers to a home invitation, one per family member. */
    replies: { type: [replySchema], default: [] },
  },
  { timestamps: true },
);

familyVisitSchema.index({ residentId: 1, startAt: -1 });
familyVisitSchema.index({ requestedBy: 1, startAt: -1 });
familyVisitSchema.index({ organizationId: 1, status: 1, startAt: 1 });
familyVisitSchema.index({ branchId: 1, status: 1, startAt: 1 });

const FamilyVisit =
  mongoose.models.FamilyVisit ||
  mongoose.model("FamilyVisit", familyVisitSchema);

module.exports = { FamilyVisit };
