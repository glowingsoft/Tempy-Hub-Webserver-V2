const mongoose = require("mongoose");
const { ExternalPersonType } = require("./domainEnums");

const policySignedSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    signedAt: { type: Date, required: true },
    signatureUrl: { type: String, default: "" },
  },
  { _id: false }
);

const externalPersonSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(ExternalPersonType),
      required: true,
    },
    /** Set only when the person has a login for the visitor app. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    carRegistration: { type: String, default: "" },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PersonCategory",
      default: null,
    },
    /**
     * @deprecated Superseded by `categoryId`. Retained until existing rows are
     * mapped onto `PersonCategory`; free text cannot be grouped reliably.
     */
    visitorCategory: { type: String, default: "" },
    policiesSigned: { type: [policySignedSchema], default: [] },
    /** Use null when unset — never "" — so sparse unique indexes stay valid. */
    qrToken: { type: String, default: null },
    nfcTagId: { type: String, default: null },
  },
  { timestamps: true }
);

// List/filter: branch (+ optional type), newest first. Covers branchId-only lookups too.
externalPersonSchema.index({ branchId: 1, type: 1, createdAt: -1 });
externalPersonSchema.index({ branchId: 1, departmentId: 1, createdAt: -1 });

// Optional identity links — sparse so many nulls are allowed; unique only when set.
externalPersonSchema.index({ userId: 1 }, { unique: true, sparse: true });
externalPersonSchema.index({ qrToken: 1 }, { unique: true, sparse: true });
externalPersonSchema.index({ nfcTagId: 1 }, { unique: true, sparse: true });

const ExternalPerson =
  mongoose.models.ExternalPerson ||
  mongoose.model("ExternalPerson", externalPersonSchema);

module.exports = { ExternalPerson };
