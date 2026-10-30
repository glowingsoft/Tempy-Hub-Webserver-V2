const mongoose = require("mongoose");
const { FamilyGazetteItemStatus } = require("./domainEnums");

const objectId = (ref, extra = {}) => ({
  type: mongoose.Schema.Types.ObjectId,
  ref,
  ...extra,
});

/**
 * One resident's gazette in one issue. The content is chosen and stored before the PDF is drawn, so a
 * failed render can be retried without losing it.
 */
const familyGazetteItemSchema = new mongoose.Schema(
  {
    issueId: objectId("FamilyGazetteIssue", { required: true }),
    organizationId: objectId("Organization", { required: true }),
    branchId: objectId("Branch", { required: true }),
    residentId: objectId("Resident", { required: true }),
    status: {
      type: String,
      enum: Object.values(FamilyGazetteItemStatus),
      default: FamilyGazetteItemStatus.BUILDING,
    },
    /** Approved family uploads in the gazette, newest first, at most the cap. */
    uploadIds: [objectId("FamilyUpload")],
    /** Over the cap: left for the next issue unless staff swap them in. */
    movedUploadIds: [objectId("FamilyUpload")],
    /** Taken out by staff before printing. */
    removedUploadIds: [objectId("FamilyUpload")],
    /** Wall posts tagged to this resident, for "Life at the home". */
    postIds: [objectId("FamilyPost")],
    /** How many family messages were sent for this issue (the table's Messages column; it can be over the cap), and whether it is. */
    messageCount: { type: Number, default: 0 },
    overCap: { type: Boolean, default: false },
    /** People linked to the resident when the issue was built. */
    familyCount: { type: Number, default: 0 },
    pdfKey: { type: String, default: "" },
    /** Pages in the drawn PDF, for the reader ("2/6"). */
    pageCount: { type: Number, default: 0 },
    failureReason: { type: String, default: "" },
    generatedAt: { type: Date, default: null },
    /** When a drawing of this gazette was last started; a drawing that never finished is picked up again after a while. */
    renderClaimedAt: { type: Date, default: null },
    printedBy: objectId("User", { default: null }),
    printedAt: { type: Date, default: null },
    /** The day the home gave the printed copy to the resident. */
    givenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

familyGazetteItemSchema.index({ issueId: 1, residentId: 1 }, { unique: true });
familyGazetteItemSchema.index({ issueId: 1, status: 1 });
familyGazetteItemSchema.index({ residentId: 1, createdAt: -1 });

const FamilyGazetteItem =
  mongoose.models.FamilyGazetteItem ||
  mongoose.model("FamilyGazetteItem", familyGazetteItemSchema);

module.exports = { FamilyGazetteItem };
