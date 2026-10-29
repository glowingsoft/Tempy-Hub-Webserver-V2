const jwt = require("jsonwebtoken");
const { User } = require("@models/UserModel");
const { AuthAudience } = require("@models/domainEnums");
const { getUserRoom } = require("./chatSocketRooms");

const ALLOWED_AUDIENCES = [AuthAudience.FAMILY, AuthAudience.STAFF];
const BLOCKED_STATUSES = ["restricted", "suspended"];

/**
 * Chat sockets only push: a client proves who it is with its login token, joins its own room and listens. It
 * can send nothing, and the room comes from the token, never from anything the client claims.
 */
const chatSocketHandler = (io) => {
  io.on("connection", async (socket) => {
    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};
    const token = auth.token || query.token;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const audience = decoded.audience || AuthAudience.STAFF;
      if (!decoded._id || !ALLOWED_AUDIENCES.includes(audience))
        return socket.disconnect(true);

      const allowed = await User.exists({
        _id: decoded._id,
        "accountState.status": { $nin: BLOCKED_STATUSES },
      });
      if (!allowed) return socket.disconnect(true);

      return socket.join(getUserRoom(decoded._id));
    } catch {
      return socket.disconnect(true);
    }
  });
};

module.exports = chatSocketHandler;
