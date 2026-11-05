const { respond } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const superAdminDashboardService = require("@adminServices/dashboard/superAdminDashboardService");

const getDashboard = respond((req) => {
  const year = queryText(req.query.year);
  return superAdminDashboardService.getDashboard({
    organizationId: queryId(req.query.organizationId, "organizationId"),
    year: year === undefined ? undefined : Number(year),
  });
});

module.exports = { getDashboard };
