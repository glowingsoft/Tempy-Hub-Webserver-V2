const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const kioskScreenService = require("@adminServices/kiosk/kioskScreenService");

const listKiosks = respond(
  (req) =>
    kioskScreenService.getKiosksScreen({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      ...parsePaginationParams(req),
    }),
  { paged: true },
);

module.exports = { listKiosks };
