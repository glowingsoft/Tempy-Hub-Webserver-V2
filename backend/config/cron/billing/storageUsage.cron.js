const { recalculateAll } = require("@adminServices/billing/billingUsageService");

const runStorageUsageCron = () => recalculateAll();

const runStorageUsageCatchUp = () => recalculateAll({ unmeasuredOnly: true });

module.exports = { runStorageUsageCron, runStorageUsageCatchUp };
