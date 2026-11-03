const mongoose = require("mongoose");
const {
  VisitorSurveyQuestionType,
  VisitorSurveyQuestionSource,
} = require("./domainEnums");

const visitorSurveyQuestionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    key: { type: String, required: true, trim: true },
    prompt: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: Object.values(VisitorSurveyQuestionType),
      required: true,
    },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    source: {
      type: String,
      enum: Object.values(VisitorSurveyQuestionSource),
      default: VisitorSurveyQuestionSource.CUSTOM,
    },
  },
  { timestamps: true }
);

visitorSurveyQuestionSchema.index(
  { organizationId: 1, key: 1 },
  { unique: true }
);
visitorSurveyQuestionSchema.index({ organizationId: 1, sortOrder: 1 });

const VisitorSurveyQuestion =
  mongoose.models.VisitorSurveyQuestion ||
  mongoose.model("VisitorSurveyQuestion", visitorSurveyQuestionSchema);

module.exports = { VisitorSurveyQuestion };
