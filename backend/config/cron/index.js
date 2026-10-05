const cron = require("node-cron");
const { acquireLock, releaseLock } = require("../redis/redisCache");

const { runEventReminderCron } = require("./events/eventReminder.cron");
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



};

module.exports = { startCrons };
