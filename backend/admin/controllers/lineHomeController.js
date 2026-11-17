const { respond } = require("@utils/controllerResponse");
const lineHomeService = require("@adminServices/dashboard/lineHomeService");

const getHome = respond((req) =>
  lineHomeService.getLineHome({
    actor: req.user,
    organizationId: req.orgId,
  }),
);

module.exports = { getHome };
