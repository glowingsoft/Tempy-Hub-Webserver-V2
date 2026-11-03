const mongoose = require("mongoose");
const { JobTitleLevel } = require("./domainEnums");
const { nameKeyOf } = require("../helperUtils/nameKey");

const jobTitleSchema = new mongoose.Schema(
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
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, trim: true },
    level: {
      type: String,
      enum: Object.values(JobTitleLevel),
      default: JobTitleLevel.OPERATIONAL,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

jobTitleSchema.pre("validate", function setNameKey(next) {
  if (this.name) this.nameKey = nameKeyOf(this.name);
  next();
});

jobTitleSchema.index(
  { organizationId: 1, branchId: 1, nameKey: 1 },
  { unique: true }
);

const JobTitle =
  mongoose.models.JobTitle || mongoose.model("JobTitle", jobTitleSchema);

module.exports = { JobTitle };
