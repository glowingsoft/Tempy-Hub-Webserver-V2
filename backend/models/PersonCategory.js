const mongoose = require("mongoose");
const { PersonCategoryAppliesTo } = require("./domainEnums");

const personCategorySchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    appliesTo: {
      type: String,
      enum: Object.values(PersonCategoryAppliesTo),
      default: PersonCategoryAppliesTo.ANY,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const PersonCategory =
  mongoose.models.PersonCategory ||
  mongoose.model("PersonCategory", personCategorySchema);

module.exports = { PersonCategory };
