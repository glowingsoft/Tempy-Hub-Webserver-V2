const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const visitSessionService = require("@adminServices/visitors/visitSessionService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const {
  ExternalPersonType,
  VisitMethod,
} = require("@models/domainEnums");

const checkIn = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["branchId", "externalPersonId"],
    })
  ) {
    return;
  }

  try {
    const data = await visitSessionService.checkIn({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      externalPersonId: req.body.externalPersonId,
      method: req.body.method,
      purposeOfVisit: req.body.purposeOfVisit,
      hostStaffId: req.body.hostStaffId,
      hostName: req.body.hostName,
      kioskId: req.body.kioskId,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "visit_checked_in_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const registerAndCheckIn = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["branchId", "type", "name"],
      enumFields: {
        type: Object.values(ExternalPersonType),
        ...(req.body.method
          ? { method: Object.values(VisitMethod) }
          : {}),
      },
    })
  ) {
    return;
  }

  try {
    const data = await visitSessionService.registerAndCheckIn({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      type: req.body.type,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      method: req.body.method,
      purposeOfVisit: req.body.purposeOfVisit,
      hostStaffId: req.body.hostStaffId,
      hostName: req.body.hostName,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "visit_checked_in_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const checkOut = async (req, res) => {
  try {
    const data = await visitSessionService.checkOut({
      actor: req.user,
      organizationId: req.orgId,
      visitSessionId: req.params.visitSessionId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "visit_checked_out_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const approve = async (req, res) => {
  try {
    const data = await visitSessionService.approveVisitSession({
      actor: req.user,
      organizationId: req.orgId,
      visitSessionId: req.params.visitSessionId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "visit_checked_in_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listVisitSessions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await visitSessionService.listVisitSessions({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      personType: req.query.personType || req.query.type,
      status: req.query.status,
      method: req.query.method,
      from: req.query.from,
      to: req.query.to,
      externalPersonId: req.query.externalPersonId,
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

const getVisitSession = async (req, res) => {
  try {
    const data = await visitSessionService.getVisitSession({
      actor: req.user,
      organizationId: req.orgId,
      visitSessionId: req.params.visitSessionId,
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

const getOnSiteCounts = async (req, res) => {
  try {
    const data = await visitSessionService.getOnSiteCounts({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      personType: req.query.personType || req.query.type,
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

const getVisitAnalytics = async (req, res) => {
  try {
    const data = await visitSessionService.getVisitAnalytics({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      personType: req.query.personType || req.query.type,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      groupBy: req.query.groupBy,
      onSiteOnly: req.query.onSiteOnly,
      timezone: req.query.timezone,
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

module.exports = {
  checkIn,
  registerAndCheckIn,
  checkOut,
  approve,
  listVisitSessions,
  getVisitSession,
  getOnSiteCounts,
  getVisitAnalytics,
};
