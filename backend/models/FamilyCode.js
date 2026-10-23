const mongoose = require("mongoose");
const { FamilyCodeStatus } = require("./domainEnums");

/**
 * The code is never stored as typed. `codeHash` (a keyed hash) is how a code typed by someone
 * is found; `codeCipher` (encrypted) is how the next of kin sees it again. See familyCodeCrypto.
 * A resident has one active code; a new one voids the old.
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
    codeHash: { type: String, required: true },
    codeCipher: { type: String, required: true },
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

familyCodeSchema.index({ codeHash: 1 }, { unique: true });

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
