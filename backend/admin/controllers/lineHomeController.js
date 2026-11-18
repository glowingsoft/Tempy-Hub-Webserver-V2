const { respond } = require("@utils/controllerResponse");
const { parsePaginationParams } = require("@utils/responseUtil");
const lineHomeService = require("@adminServices/dashboard/lineHomeService");
const lineHomeTodayService = require("@adminServices/dashboard/lineHomeTodayService");

const getHome = respond((req) =>
  lineHomeService.getLineHome({
    actor: req.user,
    organizationId: req.orgId,
  }),
);

const getToday = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return lineHomeTodayService.getLineHomeToday({
      actor: req.user,
      organizationId: req.orgId,
      tab: req.query.tab,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

module.exports = { getHome, getToday };
