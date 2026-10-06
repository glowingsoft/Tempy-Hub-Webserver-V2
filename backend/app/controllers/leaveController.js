const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const leaveService = require("@adminServices/leave/leaveService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.createLeaveRequest({
      userId: req.user._id,
      organizationId: req.orgId,
      leaveType: req.body.leaveType,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      totalDays: req.body.totalDays,
      reason: req.body.reason,
      attachmentUrl: req.body.attachmentUrl,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "leave_request_created",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listMyLeaveRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await leaveService.listMyLeaveRequests({
      userId: req.user._id,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      status: req.query.status,
      leaveType: req.query.leaveType,
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

const getMyLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.getMyLeaveRequest({
      userId: req.user._id,
      organizationId: req.orgId,
      requestId: req.params.requestId,
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

const cancelLeaveRequest = async (req, res) => {
  try {
    const data = await leaveService.cancelLeaveRequest({
      userId: req.user._id,
      organizationId: req.orgId,
      requestId: req.params.requestId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "leave_request_cancelled",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listMyEntitlements = async (req, res) => {
  try {
    const data = await leaveService.listMyEntitlements({
      userId: req.user._id,
      organizationId: req.orgId,
      year: req.query.year,
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

const listMyLeaveScores = async (req, res) => {
  try {
    const data = await leaveService.listMyLeaveScores({
      userId: req.user._id,
      organizationId: req.orgId,
      from: req.query.from,
      to: req.query.to,
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
  createLeaveRequest,
  listMyLeaveRequests,
  getMyLeaveRequest,
  cancelLeaveRequest,
  listMyEntitlements,
  listMyLeaveScores,
};
