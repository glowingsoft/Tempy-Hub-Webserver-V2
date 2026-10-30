const mongoose = require("mongoose");
const { FamilyHandoverStatus } = require("./domainEnums");

/**
 * The next of kin asking someone to take over (Figma: Leave Margaret's Family).
 * The next of kin keeps the role until the other person accepts. `homeChooses`
 * means the home picks the new next of kin, so there is no `toUserId`.
 */
const familyHandoverSchema = new mongoose.Schema(
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
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    homeChooses: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(FamilyHandoverStatus),
      default: FamilyHandoverStatus.PENDING,
    },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

familyHandoverSchema.index({ toUserId: 1, status: 1 });
familyHandoverSchema.index({ fromUserId: 1, status: 1 });

// one open handover per resident
familyHandoverSchema.index(
  { residentId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: FamilyHandoverStatus.PENDING },
  },
);

const FamilyHandover =
  mongoose.models.FamilyHandover ||
  mongoose.model("FamilyHandover", familyHandoverSchema);

module.exports = { FamilyHandover };
