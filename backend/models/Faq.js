// models/FAQ.js
const mongoose = require("mongoose");

const FAQSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },
    answer: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },
    /** "family" questions are shown on the family app's Help & Contact screen. */
    audience: {
      type: String,
      enum: ["general", "family"],
      default: "general",
    },
  },
  {
    timestamps: true,
  }
);

FAQSchema.index({ createdAt: -1 });

const Faq = mongoose.model("Faq", FAQSchema);

module.exports = Faq;
