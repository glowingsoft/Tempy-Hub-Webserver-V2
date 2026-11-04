const { respond } = require("@utils/controllerResponse");
const lineDashboardService = require("@adminServices/dashboard/lineDashboardService");

const getDashboard = respond((req) =>
  lineDashboardService.getLineDashboard({
    actor: req.user,
    organizationId: req.orgId,
  }),
);

module.exports = { getDashboard };
