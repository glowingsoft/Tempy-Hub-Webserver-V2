const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const familyVisitStaffService = require("@adminServices/family/familyVisitStaffService");

const { VisitDecision } = familyVisitStaffService;

const withScope = (req) => ({ actor: req.user, organizationId: req.orgId });

const REQUESTS_PAGE_SIZE = 20;
const REQUESTS_MAX_PAGE_SIZE = 50;

const listRequests = respond(
  (req) => {
    const { page } = parsePaginationParams(req);
    const requested = parseInt(req.query.limit, 10);
    const limit =
      requested >= 1
        ? Math.min(requested, REQUESTS_MAX_PAGE_SIZE)
        : REQUESTS_PAGE_SIZE;
    return familyVisitStaffService.listVisits({
      ...withScope(req),
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      status: queryText(req.query.status) || "requested",
      source: queryText(req.query.source),
      range: queryText(req.query.range) || "upcoming",
      withVisiting: true,
      page,
      limit,
      skip: (page - 1) * limit,
    });
  },
  { paged: true },
);

const getCapacity = respond((req) =>
  familyVisitStaffService.getCapacity({
    ...withScope(req),
    branchId: queryId(req.query.branchId, "branchId"),
    date: queryText(req.query.date),
  }),
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

const updateRequest = respondByAction({
  approve: decide(VisitDecision.CONFIRM, "visit_request_confirmed"),
  decline: decide(VisitDecision.DECLINE, "visit_request_declined"),
  cancel: decide(VisitDecision.CANCEL, "visit_cancelled"),
});

const setVisiting = (paused, translationKey) => ({
  run: (req) =>
    familyVisitStaffService.setVisiting({
      ...withScope(req),
      branchId: queryId(req.body.branchId, "branchId"),
      paused,
      reason: req.body.reason,
    }),
  translationKey,
});

const updateVisiting = respondByAction({
  pause: setVisiting(true, "visiting_paused_set"),
  resume: setVisiting(false, "visiting_resumed"),
});

module.exports = { listRequests, getCapacity, updateRequest, updateVisiting };
