const mongoose = require("mongoose");
const { OrganizationStatus } = require("./domainEnums");
const { nameKeyOf } = require("../helperUtils/nameKey");

const moduleAccessSchema = new mongoose.Schema(
  {
    moduleSlug: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    purchasedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Case- and spacing-insensitive form of `name`; see the unique index below. */
    nameKey: { type: String, default: undefined },
    /**
     * Null until the invited owner accepts: the platform operator names an
     * organization's owner by email, and that person may not have an account
     * yet. Set when the invitation is redeemed.
     */
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(OrganizationStatus),
      default: OrganizationStatus.PENDING_ACTIVATION,
    },
    moduleAccess: { type: [moduleAccessSchema], default: [] },
    settings: {
      emergencyNotifyOffsite: { type: Boolean, default: false },
      /** Null on a staff profile means this interval. */
      defaultSupervisionIntervalMonths: { type: Number, default: 3, min: 1 },
      /** Null on a staff profile means this interval. */
      defaultAppraisalIntervalMonths: { type: Number, default: 12, min: 1 },
      /** Line managers allowed to write appraisals. Empty means site managers only. */
      appraisalWriterStaffIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "StaffProfile",
        },
      ],
    },
  },
  { timestamps: true }
);

organizationSchema.pre("save", function setNameKey(next) {
  if (this.isModified("name")) this.nameKey = nameKeyOf(this.name);
  next();
});

/**
 * Partial so the index can be built before existing rows are backfilled;
 * every write path sets `nameKey`, so nothing escapes it afterwards.
 */
organizationSchema.index(
  { nameKey: 1 },
  { unique: true, partialFilterExpression: { nameKey: { $type: "string" } } }
);

const Organization =
  mongoose.models.Organization ||
  mongoose.model("Organization", organizationSchema);

module.exports = { Organization };
