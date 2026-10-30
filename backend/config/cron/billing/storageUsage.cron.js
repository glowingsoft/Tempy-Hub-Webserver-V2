const { recalculateAll } = require("@adminServices/billing/billingUsageService");

/** Measures what every active organization stores, so the Billing & Usage screen stays current. */
const runStorageUsageCron = () => recalculateAll();

module.exports = { runStorageUsageCron };
