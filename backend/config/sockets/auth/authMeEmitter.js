const { AuthAudience, ActiveInactiveStatus } = require("@models/domainEnums");
const { getUserRoom, getOrgRoom } = require("./authSocketRooms");

const AUTH_NAMESPACE = "/auth";
const EVENT = "auth:me:updated";
const ORG_FANOUT_CONCURRENCY = 8;

const getAuthNamespace = () => {
  const io = global.io;
  if (!io || typeof io.of !== "function") return null;
  return io.of(AUTH_NAMESPACE);
};

const mapLimit = async (items, limit, iteratee) => {
  if (!items.length) return;
  const workers = Math.min(limit, items.length);
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const current = items[index++];
      await iteratee(current);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
};

const emitAuthMeForUser = async ({
  userId,
  organizationId,
  audience = AuthAudience.STAFF,
}) => {
  const ns = getAuthNamespace();
  if (!ns || !userId) return;

  try {
    const { me } = require("@commonServices/auth/authService");
    const data = await me({
      userId,
      audience,
      organizationId,
    });
    ns.to(getUserRoom(userId)).emit(EVENT, data);
  } catch (error) {
    console.error("auth me socket push failed", error.message);
  }
};

const connectedUserIdsForOrg = async (ns, organizationId) => {
  try {
    const sockets = await ns.in(getOrgRoom(organizationId)).fetchSockets();
    return [
      ...new Set(
        sockets.map((socket) => socket.data?.userId).filter(Boolean)
      ),
    ];
  } catch (error) {
    console.error("auth me fetchSockets failed", error.message);
    return null;
  }
};

const activeMemberUserIds = async (organizationId) => {
  const { Membership } = require("@models/Membership");
  const ids = await Membership.distinct("userId", {
    organizationId,
    status: ActiveInactiveStatus.ACTIVE,
  });
  return ids.map((id) => String(id));
};

const emitAuthMeForOrganization = async ({
  organizationId,
  audience = AuthAudience.STAFF,
}) => {
  const ns = getAuthNamespace();
  if (!ns || !organizationId) return;

  try {
    const connectedIds = await connectedUserIdsForOrg(ns, organizationId);
    const userIds =
      connectedIds === null
        ? await activeMemberUserIds(organizationId)
        : connectedIds;

    await mapLimit(userIds, ORG_FANOUT_CONCURRENCY, (userId) =>
      emitAuthMeForUser({ userId, organizationId, audience })
    );
  } catch (error) {
    console.error("auth me org socket push failed", error.message);
  }
};

const notifyAuthMeForUser = (params) => {
  setImmediate(() => {
    emitAuthMeForUser(params);
  });
};

const notifyAuthMeForOrganization = (params) => {
  setImmediate(() => {
    emitAuthMeForOrganization(params);
  });
};

module.exports = {
  EVENT,
  emitAuthMeForUser,
  emitAuthMeForOrganization,
  notifyAuthMeForUser,
  notifyAuthMeForOrganization,
};
