const {
  processPendingExports,
  removeExpiredExports,
} = require("@appServices/family/familyDataExportService");

/** Data copies left unfinished are built, and expired ones are deleted. */
const runFamilyDataExportsCron = async () => {
  await processPendingExports();
  await removeExpiredExports();
};

module.exports = { runFamilyDataExportsCron };
