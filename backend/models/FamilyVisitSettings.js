const mongoose = require("mongoose");

const protectedTimeSchema = new mongoose.Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    label: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/** What a site offers on Book A Visit, and whether visiting is paused there. One document per site. */
const familyVisitSettingsSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      unique: true,
    },
    visitingHours: {
      start: { type: String, default: undefined },
      end: { type: String, default: undefined },
    },
    /** Daily windows nobody can book, such as a mealtime. */
    protectedTimes: { type: [protectedTimeSchema], default: undefined },
    daysAhead: { type: Number, min: 1, max: 60, default: undefined },
    maxPartySize: { type: Number, min: 1, max: 20, default: undefined },
    paused: { type: Boolean, default: false },
    pausedReason: { type: String, default: "", trim: true },
    pausedAt: { type: Date, default: null },
    pausedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const FamilyVisitSettings =
  mongoose.models.FamilyVisitSettings ||
  mongoose.model("FamilyVisitSettings", familyVisitSettingsSchema);

module.exports = { FamilyVisitSettings };
