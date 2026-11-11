const mongoose = require("mongoose");
const { EvacPersonKind, EvacCheckStatus } = require("./domainEnums");

const evacCheckSchema = new mongoose.Schema(
  {
    evacuationEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EvacuationEvent",
      required: true,
      index: true,
    },
    personKind: {
      type: String,
      enum: Object.values(EvacPersonKind),
      required: true,
    },
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(EvacCheckStatus),
      default: EvacCheckStatus.UNKNOWN,
    },
    markedAt: { type: Date, required: true },
    /**
     * Where the person was when they marked safe. The label is authoritative —
     * care homes are indoors, where GPS drifts far enough that a coordinate can
     * point a warden at the wrong building. Coordinates are context only.
     */
    locationLabel: { type: String, default: "" },
    geo: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracy: { type: Number, default: null },
    },
    /** Last recorded position of someone not yet accounted for, e.g. "Room 8". */
    lastSeenLabel: { type: String, default: "" },
    lastSeenAt: { type: Date, default: null },
    /** Omitted unless sent: a stored null would collide on the sparse unique index below. */
    clientEventId: { type: String, default: undefined },
  },
  { timestamps: true }
);

evacCheckSchema.index(
  { clientEventId: 1 },
  { unique: true, sparse: true }
);

evacCheckSchema.index(
  { evacuationEventId: 1, personKind: 1, personId: 1 },
  { unique: true }
);

const EvacCheck =
  mongoose.models.EvacCheck || mongoose.model("EvacCheck", evacCheckSchema);

module.exports = { EvacCheck };
