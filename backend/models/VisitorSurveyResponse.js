const mongoose = require("mongoose");
const { VisitorSurveyResponseSource } = require("./domainEnums");

const answerSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VisitorSurveyQuestion",
      required: true,
    },
    key: { type: String, default: "", trim: true },
    prompt: { type: String, default: "", trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const visitorSurveyResponseSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    visitSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VisitSession",
      default: null,
    },
    externalPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExternalPerson",
      default: null,
    },
    visitorName: { type: String, required: true, trim: true },
    stayDuration: { type: String, default: "", trim: true },
    answers: { type: [answerSchema], default: [] },
    rating: { type: Number, default: null },
    whoVisited: { type: String, default: "" },
    comments: { type: String, default: "" },
    source: {
      type: String,
      enum: Object.values(VisitorSurveyResponseSource),
      default: VisitorSurveyResponseSource.ADMIN_MANUAL,
    },
    submittedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

visitorSurveyResponseSchema.index({ organizationId: 1, createdAt: -1 });
visitorSurveyResponseSchema.index({ organizationId: 1, branchId: 1, createdAt: -1 });

const VisitorSurveyResponse =
  mongoose.models.VisitorSurveyResponse ||
  mongoose.model("VisitorSurveyResponse", visitorSurveyResponseSchema);

module.exports = { VisitorSurveyResponse };
