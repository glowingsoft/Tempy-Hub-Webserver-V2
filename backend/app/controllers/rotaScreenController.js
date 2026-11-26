const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const rotaScreenService = require("@adminServices/rota/rotaScreenService");

const getRota = respond((req) =>
  rotaScreenService.getRotaScreen({
    actor: req.user,
    organizationId: req.orgId,
    organization: req.organization,
    isPlatformAdmin: req.isPlatformAdmin,
    branchId: req.query.branchId,
    tab: req.query.tab,
    date: req.query.date,
    ...parsePaginationParams(req),
  }),
);

module.exports = { getRota };
