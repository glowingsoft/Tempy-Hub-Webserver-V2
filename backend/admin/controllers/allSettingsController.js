const { respond } = require("@utils/controllerResponse");
const { queryId } = require("@utils/familyQuery");
const settingsOverviewService = require("@adminServices/settings/settingsOverviewService");

const contextOf = (req) => ({
  actor: req.user,
  role: req.membership?.role,
  permissions: req.membership?.permissions,
  organization: req.organization,
  organizationId: req.orgId,
});

const getAll = respond((req) =>
  settingsOverviewService.getAll({
    ...contextOf(req),
    branchId: queryId(req.query.branchId, "branchId"),
  }),
);

const updateAll = respond(
  (req) => settingsOverviewService.updateAll({ ...contextOf(req), body: req.body }),
  { translationKey: "settings_saved" },
);

module.exports = { getAll, updateAll };
