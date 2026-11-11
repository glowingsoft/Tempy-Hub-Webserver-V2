const mongoose = require("mongoose");
const {
  EvacuationType,
  EvacuationStatus,
  FamilyAlertStatus,
  FamilyUpdatePreset,
} = require("./domainEnums");

const familyUpdateSchema = new mongoose.Schema(
  {
    presets: {
      type: [{ type: String, enum: Object.values(FamilyUpdatePreset) }],
      default: [],
    },
    message: { type: String, default: "" },
    sentAt: { type: Date, required: true },
    sentByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    familiesNotified: { type: Number, default: 0 },
  },
  { _id: false },
);

const familyAlertSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(FamilyAlertStatus),
      default: FamilyAlertStatus.NOT_SENT,
    },
    alertedAt: { type: Date, default: null },
    alertedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    familiesNotified: { type: Number, default: 0 },
    updates: { type: [familyUpdateSchema], default: [] },
    allClearAt: { type: Date, default: null },
    allClearByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { _id: false },
);

const evacuationEventSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(EvacuationType),
      required: true,
    },
    startedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    startedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(EvacuationStatus),
      default: EvacuationStatus.ACTIVE,
    },
    familyAlert: { type: familyAlertSchema, default: () => ({}) },
  },
  { timestamps: true },
);

const EvacuationEvent =
  mongoose.models.EvacuationEvent ||
  mongoose.model("EvacuationEvent", evacuationEventSchema);

module.exports = { EvacuationEvent };
