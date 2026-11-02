const cron = require("node-cron");
const { acquireLock, releaseLock } = require("../redis/redisCache");
const { isRedisUp } = require("../redis/redisConfig");
const { runHeartbeatCron } = require("./jobs/heartbeat.cron");
const { runAutoCheckoutCron } = require("./jobs/autoCheckout.cron");
const {
  runFamilyScheduledPostsCron,
  runFamilyScheduledNewslettersCron,
} = require("./family/familyPosts.cron");
const {
  runFamilyGazetteRecoveryCron,
  runFamilyGazetteSchedulerCron,
} = require("./family/familyGazettes.cron");
const { runStorageUsageCron } = require("./billing/storageUsage.cron");

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

  registerJob({
    name: "family-scheduled-posts",
    schedule: "* * * * *",
    ttlSec: 50,
    enabled: true,
    run: runFamilyScheduledPostsCron,
  });

  registerJob({
    name: "family-scheduled-newsletters",
    schedule: "* * * * *",
    ttlSec: 50,
    enabled: true,
    run: runFamilyScheduledNewslettersCron,
  });

  registerJob({
    name: "family-gazette-scheduler",
    schedule: "*/15 * * * *",
    ttlSec: 800,
    enabled: true,
    run: runFamilyGazetteSchedulerCron,
  });

  registerJob({
    name: "family-gazette-recovery",
    schedule: "*/5 * * * *",
    ttlSec: 280,
    enabled: true,
    run: runFamilyGazetteRecoveryCron,
  });

  registerJob({
    name: "storage-usage",
    schedule: process.env.CRON_STORAGE_USAGE_SCHEDULE || "30 2 * * *",
    ttlSec: 3 * 60 * 60,
    enabled: envFlag("CRON_STORAGE_USAGE", true),
    run: runStorageUsageCron,
  });
};

module.exports = { startCrons };
