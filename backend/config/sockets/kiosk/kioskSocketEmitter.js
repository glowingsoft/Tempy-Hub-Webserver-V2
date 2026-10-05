function emitKioskPairingReady({ kioskId, session }) {
  const io = global.io;
  if (!io) return;

  const payload = {
    event: "kiosk:pairing:ready",
    sessionId: String(session._id),
    staffId: String(session.staffId),
    timestamp: Date.now(),
  };

  io.of("/kiosk").to(`kiosk:${String(kioskId)}`).emit("kiosk:pairing:ready", payload);
}

module.exports = { emitKioskPairingReady };
