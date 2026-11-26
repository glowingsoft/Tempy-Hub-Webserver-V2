const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const reportsScreenService = require("@adminServices/dashboard/reportsScreenService");

const getReports = respond((req) =>
  reportsScreenService.getReportsScreen({
    actor: req.user,
    organizationId: req.orgId,
    organization: req.organization,
    isPlatformAdmin: req.isPlatformAdmin,
    branchId: req.query.branchId,
    ...parsePaginationParams(req),
  }),
);

module.exports = { getReports };
