const mongoose = require("mongoose");
const { MembershipRole } = require("./domainEnums");

const MAX_SUBJECT_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CATEGORY_LENGTH = 30;

const AnnouncementAudience = {
  SITE_MANAGER: MembershipRole.SITE_MANAGER,
  LINE_MANAGER: MembershipRole.LINE_MANAGER,
  STAFF: MembershipRole.STAFF,
};

const ANNOUNCEMENT_AUDIENCE = Object.values(AnnouncementAudience);

const recipientSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    seenAt: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
  },
  { _id: false },
);

const announcementSchema = new mongoose.Schema(
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_SUBJECT_LENGTH,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
    },
    category: {
      type: String,
      default: "",
      trim: true,
      maxlength: MAX_CATEGORY_LENGTH,
    },
    /** Who should receive it. Empty on old rows means staff of the site. */
    audience: {
      type: [String],
      enum: ANNOUNCEMENT_AUDIENCE,
      default: () => [AnnouncementAudience.STAFF],
    },
    departmentIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    recipients: { type: [recipientSchema], default: [] },
    remindedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

announcementSchema.index({ organizationId: 1, branchId: 1, createdAt: -1 });
announcementSchema.index({ "recipients.userId": 1, createdAt: -1 });

const Announcement =
  mongoose.models.Announcement ||
  mongoose.model("Announcement", announcementSchema);

module.exports = {
  Announcement,
  AnnouncementAudience,
  ANNOUNCEMENT_AUDIENCE,
  MAX_SUBJECT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_CATEGORY_LENGTH,
};
