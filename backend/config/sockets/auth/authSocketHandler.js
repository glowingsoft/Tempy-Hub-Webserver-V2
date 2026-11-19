const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { User } = require("@models/UserModel");
const { AuthAudience } = require("@models/domainEnums");
const { getUserRoom, getOrgRoom } = require("./authSocketRooms");
const { notifyAuthMeForUser } = require("./authMeEmitter");

const ALLOWED_AUDIENCES = [AuthAudience.STAFF, AuthAudience.FAMILY];
const BLOCKED_STATUSES = ["restricted", "suspended"];

const authSocketHandler = (io) => {
  io.on("connection", async (socket) => {
    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};
    const token = auth.token || query.token;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const audience = decoded.audience || AuthAudience.STAFF;
      if (!decoded._id || !ALLOWED_AUDIENCES.includes(audience)) {
        return socket.disconnect(true);
      }

      const allowed = await User.exists({
        _id: decoded._id,
        "accountState.status": { $nin: BLOCKED_STATUSES },
      });
      if (!allowed) return socket.disconnect(true);

      socket.data.userId = String(decoded._id);
      socket.data.audience = audience;
      socket.join(getUserRoom(decoded._id));

      const organizationId = auth.organizationId || query.organizationId;
      if (
        organizationId &&
        mongoose.Types.ObjectId.isValid(String(organizationId))
      ) {
        socket.data.organizationId = String(organizationId);
        socket.join(getOrgRoom(organizationId));
      }

      notifyAuthMeForUser({
        userId: socket.data.userId,
        organizationId: socket.data.organizationId,
        audience: socket.data.audience,
      });
    } catch {
      return socket.disconnect(true);
    }
  });
};

module.exports = { authSocketHandler };
