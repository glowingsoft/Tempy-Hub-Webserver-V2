const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const attendanceService = require("@adminServices/attendance/attendanceService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getTodayAttendance = async (req, res) => {
  try {
    const data = await attendanceService.getTodayAttendance({
      userId: req.user._id,
      organizationId: req.orgId,
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

const clockIn = async (req, res) => {
  try {
    const data = await attendanceService.clockIn({
      userId: req.user._id,
      organizationId: req.orgId,
      checkInMethod: req.body.checkInMethod,
      clientEventId: req.body.clientEventId,
      geo: req.body.geo,
      occurredAt: req.body.occurredAt,
      image: req.body.image,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "attendance_clock_in_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const clockOut = async (req, res) => {
  try {
    const data = await attendanceService.clockOut({
      userId: req.user._id,
      organizationId: req.orgId,
      clientEventId: req.body.clientEventId,
      occurredAt: req.body.occurredAt,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_clock_out_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const startBreak = async (req, res) => {
  try {
    const data = await attendanceService.startBreak({
      userId: req.user._id,
      organizationId: req.orgId,
      occurredAt: req.body.occurredAt,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_break_started",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const endBreak = async (req, res) => {
  try {
    const data = await attendanceService.endBreak({
      userId: req.user._id,
      organizationId: req.orgId,
      occurredAt: req.body.occurredAt,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_break_ended",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listMyAttendance = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta, summary } = await attendanceService.listMyAttendance({
      userId: req.user._id,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      from: req.query.from,
      to: req.query.to,
      punctualityStatus: req.query.punctualityStatus,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { days: data, summary },
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const createChangeRequest = async (req, res) => {
  try {
    const data = await attendanceService.createChangeRequest({
      userId: req.user._id,
      organizationId: req.orgId,
      attendanceDayId: req.body.attendanceDayId,
      payload: req.body.payload,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "attendance_change_request_created",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const requestRoster = async (req, res) => {
  try {
    const data = await attendanceService.requestRosterForDay({
      userId: req.user._id,
      organizationId: req.orgId,
      attendanceDayId: req.params.dayId,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "attendance_roster_request_created",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getTodayAttendance,
  clockIn,
  clockOut,
  startBreak,
  endBreak,
  listMyAttendance,
  createChangeRequest,
  requestRoster,
};
