const runHeartbeatCron = async () => {
  const log = global.logger;
  const payload = {
    job: "heartbeat",
    at: new Date().toISOString(),
  };
  if (log?.info) log.info("cron heartbeat", payload);
  else console.log("cron heartbeat", payload.at);
};

module.exports = { runHeartbeatCron };
