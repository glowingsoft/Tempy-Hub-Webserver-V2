const { recoverStuckGazettes } = require("@adminServices/family/familyGazetteAdminService");
const { generateDueIssues, sendDueReminders } = require("@adminServices/family/familyGazetteScheduler");

/** Gazettes left at Building by a server that stopped while drawing them are drawn. */
const runFamilyGazetteRecoveryCron = () => recoverStuckGazettes();

/** Issues whose period has closed are built, and families are reminded shortly before an issue closes. */
const runFamilyGazetteSchedulerCron = async () => {
  await generateDueIssues();
  await sendDueReminders();
};

module.exports = { runFamilyGazetteRecoveryCron, runFamilyGazetteSchedulerCron };
