const mongoose = require("mongoose");
const {
  KioskWidgetType,
  KioskWidgetPlacement,
} = require("./domainEnums");

const kioskWidgetSchema = new mongoose.Schema(
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
    /** Null = site default for every kiosk at the branch. */
    kioskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Kiosk",
      default: null,
      index: true,
    },
    placement: {
      type: String,
      enum: Object.values(KioskWidgetPlacement),
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(KioskWidgetType),
      required: true,
    },
    title: { type: String, default: "" },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

kioskWidgetSchema.index({
  organizationId: 1,
  branchId: 1,
  kioskId: 1,
  placement: 1,
  sortOrder: 1,
});

const KioskWidget =
  mongoose.models.KioskWidget ||
  mongoose.model("KioskWidget", kioskWidgetSchema);

module.exports = { KioskWidget };
