const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const leaveService = require("@adminServices/leave/leaveService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listLeaveRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await leaveService.listLeaveRequests({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      status: req.query.status,
      leaveType: req.query.leaveType,
      from: req.query.from,
      to: req.query.to,
      actor: req.user,
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

const getLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.getLeaveRequest({
      requestId: req.params.requestId,
      organizationId: req.orgId,
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

const approveLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.approveLeaveRequest({
      actor: req.user,
      organizationId: req.orgId,
      requestId: req.params.requestId,
      decisionNote: req.body.decisionNote,
      managerStaffId: req.staffProfile?._id || null,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "leave_request_approved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const rejectLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.rejectLeaveRequest({
      actor: req.user,
      organizationId: req.orgId,
      requestId: req.params.requestId,
      decisionNote: req.body.decisionNote,
      managerStaffId: req.staffProfile?._id || null,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "leave_request_rejected",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const recordManagerLeave = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["staffId", "startDate", "endDate", "totalDays"],
    })
  ) {
    return;
  }

  try {
    const data = await leaveService.recordManagerLeave({
      actor: req.user,
      organizationId: req.orgId,
      staffId: req.body.staffId,
      leaveType: req.body.leaveType,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      totalDays: req.body.totalDays,
      reason: req.body.reason,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "leave_recorded_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const closeLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.closeLeaveRequest({
      actor: req.user,
      organizationId: req.orgId,
      requestId: req.params.requestId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "leave_request_closed",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listEntitlements = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await leaveService.listEntitlements({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      year: req.query.year,
      leaveType: req.query.leaveType,
      actor: req.user,
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

const upsertEntitlement = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["staffId"],
    })
  ) {
    return;
  }

  try {
    const data = await leaveService.upsertEntitlement({
      actor: req.user,
      organizationId: req.orgId,
      staffId: req.body.staffId,
      year: req.body.year,
      leaveType: req.body.leaveType,
      entitlementDays: req.body.entitlementDays,
      carriedOverDays: req.body.carriedOverDays,
      recalculate: req.body.recalculate === true || req.body.recalculate === "true",
      fullYearDays: req.body.fullYearDays,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "leave_entitlement_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  recordManagerLeave,
  closeLeaveRequest,
  listEntitlements,
  upsertEntitlement,
};
