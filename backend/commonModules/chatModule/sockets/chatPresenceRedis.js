const { getRedisClient, isRedisUp } = require("../../../config/redis/redisConfig");

const ONLINE_USERS_SET_KEY = "chat:presence:onlineUsers";
const SOCKET_COUNT_PREFIX = "chat:presence:socketCount:";
const PEERS_PREFIX = "chat:presence:peers:";

// TTL for peer cache — 24 h is more than enough for any single session
const PEERS_TTL_SECONDS = 86400;

function getSocketCountKey(userId) {
  return `${SOCKET_COUNT_PREFIX}${String(userId)}`;
}

function getPeersKey(userId) {
  return `${PEERS_PREFIX}${String(userId)}`;
}

// Returns true on the user's first socket (0 -> 1) so the caller broadcasts online
async function markUserOnline(userId) {
  if (!isRedisUp()) return false;

  const redis = getRedisClient();
  const userIdStr = String(userId);

  try {
    const [[, newCount]] = await redis
      .multi()
      .incr(getSocketCountKey(userIdStr))
      .sadd(ONLINE_USERS_SET_KEY, userIdStr)
      .exec();

    return newCount === 1; // true → first socket, broadcast online
  } catch (error) {
    return false;
  }
}

// Returns true on the user's last socket so the caller broadcasts offline and clears peers
async function markUserOffline(userId) {
  if (!isRedisUp()) return false;

  const redis = getRedisClient();
  const userIdStr = String(userId);

  try {
    const remainingSockets = await redis.decr(getSocketCountKey(userIdStr));

    if (remainingSockets <= 0) {
      await redis
        .multi()
        .del(getSocketCountKey(userIdStr))
        .srem(ONLINE_USERS_SET_KEY, userIdStr)
        .exec();

      return true; // true → last socket, broadcast offline
    }

    return false;
  } catch (error) {
    return false;
  }
}

async function cacheConversationPeers(userId, peerIds = []) {
  if (!isRedisUp() || peerIds.length === 0) return;

  const redis = getRedisClient();
  const key = getPeersKey(userId);

  try {
    await redis.del(key);
    if (peerIds.length > 0) {
      await redis.sadd(key, ...peerIds.map(String));
      await redis.expire(key, PEERS_TTL_SECONDS);
    }
  } catch (error) {
  }
}

// Empty array when Redis is down or the cache is cold
async function getConversationPeers(userId) {
  if (!isRedisUp()) return [];

  const redis = getRedisClient();

  try {
    return await redis.smembers(getPeersKey(userId));
  } catch (error) {
    return [];
  }
}

async function clearConversationPeers(userId) {
  if (!isRedisUp()) return;

  const redis = getRedisClient();

  try {
    await redis.del(getPeersKey(userId));
  } catch (error) {
  }
}

async function getUsersOnlineMap(userIds = []) {
  const result = new Map();

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return result;
  }

  const normalizedIds = [...new Set(userIds.map((id) => String(id)))];

  normalizedIds.forEach((id) => {
    result.set(id, false);
  });

  if (!isRedisUp()) {
    return result;
  }

  const redis = getRedisClient();

  try {
    const pipeline = redis.pipeline();
    normalizedIds.forEach((id) => {
      pipeline.sismember(ONLINE_USERS_SET_KEY, id);
    });

    const checks = await pipeline.exec();

    checks.forEach((entry, index) => {
      const [, isMember] = entry || [];
      result.set(normalizedIds[index], Boolean(isMember));
    });
  } catch (error) {
  }

  return result;
}

module.exports = {
  markUserOnline,
  markUserOffline,
  getUsersOnlineMap,
  cacheConversationPeers,
  getConversationPeers,
  clearConversationPeers,
};
