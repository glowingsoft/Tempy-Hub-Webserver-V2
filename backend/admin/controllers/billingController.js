const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const billingUsageService = require("@adminServices/billing/billingUsageService");

const listUsage = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return billingUsageService.listUsage({
      actor: req.user,
      role: req.membership?.role,
      branchId: req.membership?.branchId,
      organizationId: req.orgId,
      filterOrganizationId: queryId(req.query.organizationId, "organizationId"),
      keyword: queryText(req.query.keyword),
      sort: queryText(req.query.sort) || undefined,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const getUsageDetail = respond((req) =>
  billingUsageService.getUsageDetail({
    actor: req.user,
    role: req.membership?.role,
    organizationId: req.params.organizationId,
    branchId: queryId(req.query.branchId, "branchId"),
    scopeOrganizationId: req.orgId,
  }),
);

module.exports = { listUsage, getUsageDetail };
