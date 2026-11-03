const { respond } = require("@utils/controllerResponse");
const ownerDashboardService = require("@adminServices/dashboard/ownerDashboardService");

const getDashboard = respond((req) =>
  ownerDashboardService.getOwnerDashboard({ organizationId: req.orgId }),
);

module.exports = { getDashboard };
