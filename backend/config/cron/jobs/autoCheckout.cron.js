const attendanceService = require("@adminServices/attendance/attendanceService");

const MAX_ROUNDS = 25;

const runAutoCheckoutCron = async () => {
  let scanned = 0;
  let closed = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await attendanceService.closeExpiredOpenSessions();
    scanned += result.scanned;
    closed += result.closed;
    if (result.scanned < 200) break;
  }

  const payload = {
    job: "auto-checkout",
    scanned,
    closed,
    at: new Date().toISOString(),
  };
  const log = global.logger;
  if (log?.info) log.info("cron auto-checkout", payload);
  else console.log("cron auto-checkout", payload);
};

module.exports = { runAutoCheckoutCron };
