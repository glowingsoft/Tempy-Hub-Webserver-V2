const { respond } = require("@utils/controllerResponse");
const staffDashboardService = require("@adminServices/dashboard/staffDashboardService");

const getDashboard = respond((req) =>
  staffDashboardService.getStaffDashboard({
    actor: req.user,
    organizationId: req.orgId,
    weekStart: req.query.weekStart,
  }),
);

module.exports = { getDashboard };
