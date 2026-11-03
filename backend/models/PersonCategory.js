const mongoose = require("mongoose");
const { PersonCategoryAppliesTo } = require("./domainEnums");
const { nameKeyOf } = require("../helperUtils/nameKey");

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
    nameKey: { type: String, required: true, trim: true },
    appliesTo: {
      type: String,
      enum: Object.values(PersonCategoryAppliesTo),
      default: PersonCategoryAppliesTo.ANY,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

personCategorySchema.pre("validate", function setNameKey(next) {
  if (this.name) this.nameKey = nameKeyOf(this.name);
  next();
});

personCategorySchema.index(
  { organizationId: 1, branchId: 1, nameKey: 1 },
  { unique: true }
);

const PersonCategory =
  mongoose.models.PersonCategory ||
  mongoose.model("PersonCategory", personCategorySchema);

module.exports = { PersonCategory };
