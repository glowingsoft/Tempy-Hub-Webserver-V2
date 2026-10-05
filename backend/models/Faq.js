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
  },
  {
    timestamps: true,
  }
);

FAQSchema.index({ createdAt: -1 });

const Faq = mongoose.model("Faq", FAQSchema);

module.exports = Faq;
