const mongoose = require("mongoose");
const { nameKeyOf } = require("../helperUtils/nameKey");

const departmentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
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
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

departmentSchema.pre("validate", function setNameKey(next) {
  if (this.name) this.nameKey = nameKeyOf(this.name);
  next();
});

departmentSchema.index(
  { organizationId: 1, branchId: 1, nameKey: 1 },
  { unique: true }
);

const Department =
  mongoose.models.Department || mongoose.model("Department", departmentSchema);

module.exports = { Department };
