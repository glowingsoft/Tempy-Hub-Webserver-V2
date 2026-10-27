const mongoose = require("mongoose");
const { nameKeyOf } = require("../helperUtils/nameKey");

const documentCategorySchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    titleKey: { type: String, required: true, trim: true },
    /**
     * Set only on the six categories that used to live on the document enum.
     * Lets old clients and the kiosk keep sending `healthAndSafety` and similar.
     */
    legacyKey: { type: String, default: null, trim: true },
    active: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

documentCategorySchema.pre("validate", function setTitleKey(next) {
  if (this.title) this.titleKey = nameKeyOf(this.title);
  next();
});

documentCategorySchema.index(
  { organizationId: 1, titleKey: 1 },
  { unique: true }
);
documentCategorySchema.index(
  { organizationId: 1, legacyKey: 1 },
  { unique: true, partialFilterExpression: { legacyKey: { $type: "string" } } }
);

const DocumentCategory =
  mongoose.models.DocumentCategory ||
  mongoose.model("DocumentCategory", documentCategorySchema);

module.exports = { DocumentCategory };
