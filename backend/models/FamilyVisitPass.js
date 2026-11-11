const mongoose = require("mongoose");

/** What a family member keeps on their Visit Pass for one resident: guests without the app and a car registration. */
const familyVisitPassSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resident",
      required: true,
    },
    guests: { type: [String], default: [] },
    /** How many guests without the app are coming, when the app only asks for a number. */
    guestCount: { type: Number, min: 0, max: 10, default: null },
    carRegistration: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

familyVisitPassSchema.index({ userId: 1, residentId: 1 }, { unique: true });

const FamilyVisitPass =
  mongoose.models.FamilyVisitPass ||
  mongoose.model("FamilyVisitPass", familyVisitPassSchema);

module.exports = { FamilyVisitPass };
