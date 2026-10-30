const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const billingUsageService = require("@adminServices/billing/billingUsageService");

const listUsage = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return billingUsageService.listUsage({
      actor: req.user,
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

const updatePlan = respond(
  (req) =>
    billingUsageService.updatePlan({
      actor: req.user,
      organizationId: req.params.organizationId,
      planLimitGb: req.body?.planLimitGb,
    }),
  { translationKey: "billing_plan_saved" },
);

const recalculate = respond(
  (req) =>
    billingUsageService.startRecalculation({
      actor: req.user,
      organizationId: req.params.organizationId,
    }),
  { statusCode: 202, translationKey: "usage_recalculation_started" },
);

const updatePrices = respond(
  (req) =>
    billingUsageService.updatePrices({
      actor: req.user,
      baseTierGbp: req.body?.baseTierGbp,
      overageGbpPerGb: req.body?.overageGbpPerGb,
    }),
  { translationKey: "billing_prices_saved" },
);

module.exports = { listUsage, updatePlan, recalculate, updatePrices };
