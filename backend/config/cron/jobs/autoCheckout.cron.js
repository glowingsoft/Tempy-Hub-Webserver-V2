const attendanceService = require("@adminServices/attendance/attendanceService");
const visitSessionService = require("@adminServices/visitors/visitSessionService");

const MAX_ROUNDS = 25;
const BATCH = 200;

const drain = async (run) => {
  let scanned = 0;
  let closed = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await run();
    scanned += result.scanned;
    closed += result.closed;
    if (result.scanned < BATCH) break;
  }
  return { scanned, closed };
};

const runAutoCheckoutCron = async () => {
  const [staff, visits] = await Promise.all([
    drain(() => attendanceService.closeExpiredOpenSessions()),
    drain(() => visitSessionService.closeExpiredVisitSessions()),
  ]);

  const payload = {
    job: "auto-checkout",
    staff,
    visits,
    at: new Date().toISOString(),
  };
  const log = global.logger;
  if (log?.info) log.info("cron auto-checkout", payload);
  else console.log("cron auto-checkout", payload);
};

module.exports = { runAutoCheckoutCron };
