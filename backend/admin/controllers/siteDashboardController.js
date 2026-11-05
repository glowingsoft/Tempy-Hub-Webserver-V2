const { respond } = require("@utils/controllerResponse");
const siteDashboardService = require("@adminServices/dashboard/siteDashboardService");

const getDashboard = respond((req) =>
  siteDashboardService.getSiteDashboard({
    actor: req.user,
    organizationId: req.orgId,
    people: req.query.people,
    period: req.query.period,
  }),
);

module.exports = { getDashboard };
