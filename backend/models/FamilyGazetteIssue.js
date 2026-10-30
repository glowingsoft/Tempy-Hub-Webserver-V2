const mongoose = require("mongoose");
const { FamilyGazetteIssueStatus } = require("./domainEnums");

/**
 * One round of gazettes for one site: the period it covers and when it closes. Its items are the
 * residents' own gazettes (Figma: Gazettes).
 */
const familyGazetteIssueSchema = new mongoose.Schema(
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
    /** Counts up per site: Issue 14. */
    number: { type: Number, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    /** Messages sent before this go in the issue; the app says "closes on 28 Oct". */
    closesAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(FamilyGazetteIssueStatus),
      default: FamilyGazetteIssueStatus.BUILDING,
    },
    messageCap: { type: Number, required: true },
    /** Who asked for it; null when the schedule did. */
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    generatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

familyGazetteIssueSchema.index({ branchId: 1, number: 1 }, { unique: true });
familyGazetteIssueSchema.index(
  { branchId: 1, periodStart: 1 },
  { unique: true },
);
familyGazetteIssueSchema.index({ organizationId: 1, createdAt: -1 });

const FamilyGazetteIssue =
  mongoose.models.FamilyGazetteIssue ||
  mongoose.model("FamilyGazetteIssue", familyGazetteIssueSchema);

module.exports = { FamilyGazetteIssue };
