const {
  sendResponse,
  parsePaginationParams,
} = require("@utils/responseUtil");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getOnSiteSummary = async (req, res) => {
  try {
    const data = await evacuationService.getOnSiteSummary({
      organizationId: req.orgId,
      branchId: req.query.branchId || req.params.branchId,
      actor: req.user,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const startEvacuation = async (req, res) => {
  try {
    const data = await evacuationService.startEvacuation({
      organizationId: req.orgId,
      branchId: req.body.branchId,
      type: req.body.type,
      startedByUserId: req.user?._id || null,
      kioskId: req.body.kioskId || null,
      actor: req.user,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "evacuation_started",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getActiveEvacuation = async (req, res) => {
  try {
    const data = await evacuationService.getActiveEvacuation({
      organizationId: req.orgId,
      branchId: req.query.branchId || req.params.branchId,
      includeStats: req.query.includeStats !== "false",
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listEvacuations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await evacuationService.listEvacuations({
      organizationId: req.orgId,
      actor: req.user,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      status: req.query.status,
      type: req.query.type,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getEvacuationEvent = async (req, res) => {
  try {
    const data = await evacuationService.getEvacuationEvent({
      organizationId: req.orgId,
      evacuationEventId: req.params.evacuationEventId,
      actor: req.user,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const closeEvacuation = async (req, res) => {
  try {
    const data = await evacuationService.closeEvacuation({
      organizationId: req.orgId,
      evacuationEventId: req.params.evacuationEventId,
      actor: req.user,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "evacuation_closed",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listEvacChecks = async (req, res) => {
  try {
    const data = await evacuationService.listEvacChecks({
      organizationId: req.orgId,
      evacuationEventId: req.params.evacuationEventId,
      actor: req.user,
      status: req.query.status,
      personKind: req.query.personKind,
      unaccountedOnly: req.query.unaccountedOnly === "true",
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const upsertEvacCheck = async (req, res) => {
  try {
    const data = await evacuationService.upsertEvacCheck({
      organizationId: req.orgId,
      evacuationEventId: req.params.evacuationEventId,
      personKind: req.body.personKind,
      personId: req.body.personId,
      status: req.body.status,
      markedAt: req.body.markedAt,
      locationLabel: req.body.locationLabel,
      geo: req.body.geo,
      lastSeenLabel: req.body.lastSeenLabel,
      lastSeenAt: req.body.lastSeenAt,
      clientEventId: req.body.clientEventId,
      actor: req.user,
      allowSelfOnly: false,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "evac_check_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getOnSiteSummary,
  startEvacuation,
  getActiveEvacuation,
  listEvacuations,
  getEvacuationEvent,
  closeEvacuation,
  listEvacChecks,
  upsertEvacCheck,
};
