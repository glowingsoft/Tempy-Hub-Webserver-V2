const mongoose = require("mongoose");

const moduleDefinitionSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const ModuleDefinition =
  mongoose.models.ModuleDefinition ||
  mongoose.model("ModuleDefinition", moduleDefinitionSchema);

module.exports = { ModuleDefinition };
