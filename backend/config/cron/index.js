const cron = require("node-cron");
const { acquireLock, releaseLock } = require("../redis/redisCache");

const { runEventReminderCron } = require("./events/eventReminder.cron");
const { runFamilyScheduledPostsCron, runFamilyScheduledNewslettersCron } = require("./family/familyPosts.cron");
const { runFamilyGazetteRecoveryCron, runFamilyGazetteSchedulerCron } = require("./family/familyGazettes.cron");
const { runStorageUsageCron, runStorageUsageCatchUp } = require("./billing/storageUsage.cron");
const startCrons = () => {


  ///* ======================================================
  //   🕛 CRON - Event reminders (every minute)
  //   ====================================================== */
  // cron.schedule("*/5 * * * * *", async () => { //5 seconds for testing
  cron.schedule("* * * * *", async () => {
    const lockKey = "cron:event-reminders";
    const lock = await acquireLock(lockKey, 50);

    if (!lock) return;

    try {
      // await runEventReminderCron();
    } catch (err) {
      console.error("Reminder cron error:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  cron.schedule("* * * * *", async () => {
    const lockKey = "cron:family-scheduled-posts";
    const lock = await acquireLock(lockKey, 50);

    if (!lock) return;

    try {
      await runFamilyScheduledPostsCron();
    } catch (err) {
      console.error("Family scheduled posts cron error:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  cron.schedule("* * * * *", async () => {
    const lockKey = "cron:family-scheduled-newsletters";
    const lock = await acquireLock(lockKey, 50);

    if (!lock) return;

    try {
      await runFamilyScheduledNewslettersCron();
    } catch (err) {
      console.error("Family scheduled newsletters cron error:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    const lockKey = "cron:family-gazette-scheduler";
    const lock = await acquireLock(lockKey, 800);

    if (!lock) return;

    try {
      await runFamilyGazetteSchedulerCron();
    } catch (err) {
      console.error("Family gazette scheduler cron error:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    const lockKey = "cron:family-gazette-recovery";
    const lock = await acquireLock(lockKey, 280);

    if (!lock) return;

    try {
      await runFamilyGazetteRecoveryCron();
    } catch (err) {
      console.error("Family gazette recovery cron error:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  cron.schedule("30 2 * * *", async () => {
    const lockKey = "cron:storage-usage";
    const lock = await acquireLock(lockKey, 3 * 60 * 60);

    if (!lock) return;

    try {
      await runStorageUsageCron();
    } catch (err) {
      console.error("Storage usage cron error:", err);
    } finally {
      await releaseLock(lockKey, lock);
    }
  });

  runStorageUsageCatchUp().catch((err) =>
    console.error("Storage usage catch-up error:", err),
  );
};

module.exports = { startCrons };
