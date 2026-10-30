const { recalculateAll } = require("@adminServices/billing/billingUsageService");

const runStorageUsageCron = () => recalculateAll();

module.exports = { runStorageUsageCron };
