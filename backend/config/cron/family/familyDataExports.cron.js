const {
  processPendingExports,
  removeExpiredExports,
} = require("@appServices/family/familyDataExportService");

const runFamilyDataExportsCron = async () => {
  await processPendingExports();
  await removeExpiredExports();
};

module.exports = { runFamilyDataExportsCron };
