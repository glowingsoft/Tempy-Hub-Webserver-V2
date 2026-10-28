const mongoose = require("mongoose");
const { FamilyNewsletterStatus } = require("./domainEnums");

const objectId = (ref, extra = {}) => ({ type: mongoose.Schema.Types.ObjectId, ref, ...extra });

/**
 * A monthly newsletter for one site (Figma: Newsletters). It starts as a draft filled in from the
 * month's wall posts, staff edit every section, and it is then sent. All text is plain text; the
 * template escapes it when it renders.
 */
const familyNewsletterSchema = new mongoose.Schema(
  {
    organizationId: objectId("Organization", { required: true }),
    branchId: objectId("Branch", { required: true }),
    authorId: objectId("User", { required: true }),
    month: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    issueNumber: { type: Number, required: true },
    template: { type: String, default: "classic" },
    title: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(FamilyNewsletterStatus),
      default: FamilyNewsletterStatus.DRAFT,
    },
    sections: {
      welcome: { type: Boolean, default: true },
      highlights: { type: Boolean, default: true },
      comingUp: { type: Boolean, default: true },
      notices: { type: Boolean, default: true },
      newResidents: { type: Boolean, default: true },
      gallery: { type: Boolean, default: true },
    },
    welcome: {
      text: { type: String, default: "" },
      signedBy: { type: String, default: "" },
    },
    highlights: [
      {
        _id: false,
        postId: objectId("FamilyPost", { required: true }),
        title: { type: String, default: "" },
        text: { type: String, default: "" },
        mediaId: objectId("FamilyMedia", { default: null }),
        postedAt: { type: Date, default: null },
      },
    ],
    comingUp: [
      {
        _id: false,
        date: { type: Date, required: true },
        time: { type: String, default: "" },
        title: { type: String, required: true },
        description: { type: String, default: "" },
        category: { type: String, default: "" },
      },
    ],
    notices: [{ _id: false, title: { type: String, required: true }, body: { type: String, default: "" } }],
    newResidents: [
      {
        _id: false,
        residentId: objectId("Resident", { required: true }),
        name: { type: String, required: true },
        roomNumber: { type: String, default: "" },
      },
    ],
    gallery: [
      {
        _id: false,
        mediaId: objectId("FamilyMedia", { required: true }),
        caption: { type: String, default: "" },
      },
    ],
    footer: {
      homeName: { type: String, default: "" },
      address: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    delivery: {
      inApp: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      pdf: { type: Boolean, default: false },
    },
    sendAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    sentBy: objectId("User", { default: null }),
    pdfKey: { type: String, default: "" },
    /** How many families and people it went to, and what happened on each channel (done, failed or skipped). */
    sentTo: {
      families: { type: Number, default: 0 },
      members: { type: Number, default: 0 },
    },
    deliveryLog: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Addresses already emailed, so a send that is resumed after a crash never mails anyone twice. */
    emailedTo: { type: [String], default: [] },
  },
  { timestamps: true }
);

familyNewsletterSchema.index({ branchId: 1, month: 1 }, { unique: true });
familyNewsletterSchema.index({ branchId: 1, issueNumber: 1 }, { unique: true });
familyNewsletterSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
familyNewsletterSchema.index({ status: 1, sendAt: 1 });

const FamilyNewsletter =
  mongoose.models.FamilyNewsletter || mongoose.model("FamilyNewsletter", familyNewsletterSchema);

module.exports = { FamilyNewsletter };
