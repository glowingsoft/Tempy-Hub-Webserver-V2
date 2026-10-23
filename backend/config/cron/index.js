const cron = require("node-cron");
const { acquireLock, releaseLock } = require("../redis/redisCache");
const { isRedisUp } = require("../redis/redisConfig");
const { runHeartbeatCron } = require("./jobs/heartbeat.cron");
const { runAutoCheckoutCron } = require("./jobs/autoCheckout.cron");

const envFlag = (key, fallback = true) => {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
};

const runLocked = async (lockKey, ttlSec, fn) => {
  const useLock = isRedisUp();
  const token = useLock ? await acquireLock(lockKey, ttlSec) : "local";
  if (!token) return;

  try {
    await fn();
  } finally {
    if (useLock) await releaseLock(lockKey, token);
  }
};

const registerJob = ({ name, schedule, ttlSec, enabled, run }) => {
  if (!enabled) return;
  if (!cron.validate(schedule)) {
    console.error(`Invalid cron schedule for ${name}: ${schedule}`);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      await runLocked(`cron:${name}`, ttlSec, run);
    } catch (error) {
      const log = global.logger;
      if (log?.error) log.error(`cron ${name} failed`, { error: error.message });
      else console.error(`cron ${name} failed:`, error);
    }
  });
};

const startCrons = () => {
  if (!envFlag("CRON_ENABLED", true)) return;

  registerJob({
    name: "heartbeat",
    schedule: process.env.CRON_HEARTBEAT_SCHEDULE || "* * * * *",
    ttlSec: 50,
    enabled: envFlag("CRON_HEARTBEAT", true),
    run: runHeartbeatCron,
  });

  registerJob({
    name: "auto-checkout",
    schedule: process.env.CRON_AUTO_CHECKOUT_SCHEDULE || "*/30 * * * *",
    ttlSec: 600,
    enabled: envFlag("CRON_AUTO_CHECKOUT", true),
    run: runAutoCheckoutCron,
  });
};

module.exports = { startCrons };
