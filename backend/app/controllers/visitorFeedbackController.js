const { respond } = require("@utils/controllerResponse");
const { parsePaginationParams } = require("@utils/responseUtil");
const visitorFeedbackScreenService = require("@adminServices/visitors/visitorFeedbackScreenService");

const getScreen = respond(
  (req) =>
    visitorFeedbackScreenService.getVisitorFeedbackScreen({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      ...parsePaginationParams(req),
    }),
);

const saveSettings = respond(
  (req) =>
    visitorFeedbackScreenService.saveVisitorFeedbackSettings({
      actor: req.user,
      organizationId: req.orgId,
      body: req.body,
    }),
  { translationKey: "visitor_survey_settings_updated" },
);

module.exports = { getScreen, saveSettings };
