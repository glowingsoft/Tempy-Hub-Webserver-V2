const jwt = require("jsonwebtoken");
const { AuthAudience } = require("@models/domainEnums");

function kioskSocketHandler(io) {
  io.on("connection", (socket) => {
    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};
    const token = auth.kioskToken || query.kioskToken;

    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.audience !== AuthAudience.KIOSK || !decoded.kioskId) {
        socket.disconnect(true);
        return;
      }

      const room = `kiosk:${decoded.kioskId}`;
      socket.join(room);

      socket.on("disconnect", () => {});
    } catch {
      socket.disconnect(true);
    }
  });
}

module.exports = { kioskSocketHandler };
