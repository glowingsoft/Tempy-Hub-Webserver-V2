const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const familyVisitStaffService = require("@adminServices/family/familyVisitStaffService");

const { VisitDecision } = familyVisitStaffService;

const withScope = (req) => ({ actor: req.user, organizationId: req.orgId });

const listVisits = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyVisitStaffService.listVisits({
      ...withScope(req),
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      status: queryText(req.query.status),
      source: queryText(req.query.source),
      range: queryText(req.query.range),
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const inviteFamily = respond(
  (req) =>
    familyVisitStaffService.inviteFamily({
      ...withScope(req),
      residentId: req.body.residentId,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      place: req.body.place,
      note: req.body.note,
    }),
  { statusCode: 201, translationKey: "visit_invited" },
);

const decide = (decision, translationKey) => ({
  run: (req) =>
    familyVisitStaffService.decideVisit({
      ...withScope(req),
      visitId: req.params.id,
      decision,
      note: req.body.note,
    }),
  translationKey,
});

const updateVisit = respondByAction({
  [VisitDecision.CONFIRM]: decide(
    VisitDecision.CONFIRM,
    "visit_request_confirmed",
  ),
  [VisitDecision.DECLINE]: decide(
    VisitDecision.DECLINE,
    "visit_request_declined",
  ),
  [VisitDecision.CANCEL]: decide(VisitDecision.CANCEL, "visit_cancelled"),
});

const getSettings = respond((req) =>
  familyVisitStaffService.getSettings({
    ...withScope(req),
    branchId: queryId(req.query.branchId, "branchId"),
  }),
);

const updateSettings = respond(
  (req) =>
    familyVisitStaffService.updateSettings({
      ...withScope(req),
      branchId: queryId(req.body.branchId, "branchId"),
      body: req.body,
    }),
  { translationKey: "visit_settings_saved" },
);

module.exports = {
  listVisits,
  inviteFamily,
  updateVisit,
  getSettings,
  updateSettings,
};
