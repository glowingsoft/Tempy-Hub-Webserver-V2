function emitKioskPairingReady({ kioskId, session }) {
  const io = global.io;
  if (!io) return;

  const payload = {
    event: "kiosk:pairing:ready",
    sessionId: String(session._id),
    kind: session.externalPersonId ? "contractor" : "staff",
    timestamp: Date.now(),
  };
  if (session.staffId) payload.staffId = String(session.staffId);
  if (session.externalPersonId) {
    payload.externalPersonId = String(session.externalPersonId);
  }

  io.of("/kiosk").to(`kiosk:${String(kioskId)}`).emit("kiosk:pairing:ready", payload);
}

module.exports = { emitKioskPairingReady };
