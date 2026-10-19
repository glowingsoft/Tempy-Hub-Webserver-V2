const mongoose = require("mongoose");
const { FamilyCodeStatus } = require("./domainEnums");

/**
 * The code a family shares so a relative can ask to join (Figma: Invite Family,
 * Join A Family). It is shown to the next of kin, so it is stored as typed rather
 * than hashed; it protects nothing by itself, because anyone who uses it still
 * needs approval, and entry is rate limited.
 *
 * A resident has at most one active code. Making a new one voids the old one.
 */
const familyCodeSchema = new mongoose.Schema(
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
    /** Looks like FH-12-7Q4K. Never contains the resident's room number. */
    code: { type: String, required: true, trim: true, uppercase: true },
    status: {
      type: String,
      enum: Object.values(FamilyCodeStatus),
      default: FamilyCodeStatus.ACTIVE,
    },
    expiresAt: { type: Date, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    voidedAt: { type: Date, default: null },
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

/** Joining looks the code up by value. */
familyCodeSchema.index({ code: 1 }, { unique: true });

/** One active code per resident; a second one cannot be created alongside it. */
familyCodeSchema.index(
  { residentId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: FamilyCodeStatus.ACTIVE },
  }
);

const FamilyCode =
  mongoose.models.FamilyCode || mongoose.model("FamilyCode", familyCodeSchema);

module.exports = { FamilyCode };
