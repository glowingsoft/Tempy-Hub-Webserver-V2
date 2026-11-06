const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const attendanceService = require("@adminServices/attendance/attendanceService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listAttendanceDays = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const result = await attendanceService.listAttendanceDays({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      from: req.query.from,
      to: req.query.to,
      presenceStatus: req.query.presenceStatus,
      leaveType: req.query.leaveType,
      punctualityStatus: req.query.punctualityStatus,
      keyword: req.query.keyword,
      actor: req.user,
      format: req.query.format,
    });

    if (result.csv != null) {
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.status(200).send(result.csv);
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { days: result.data, summary: result.summary },
      meta: result.meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const attendanceReport = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const {
      from,
      to,
      timezone,
      branchId,
      kpis,
      weekly,
      rows,
      meta,
    } = await attendanceService.attendanceReport({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      departmentId: req.query.departmentId,
      from: req.query.from,
      to: req.query.to,
      page,
      limit,
      skip,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { from, to, timezone, branchId, kpis, weekly, rows },
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listAttendanceRota = async (req, res) => {
  try {
    const data = await attendanceService.listAttendanceRota({
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      from: req.query.from,
      to: req.query.to,
      timezone: req.query.timezone,
      keyword: req.query.keyword,
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

const getAttendanceDay = async (req, res) => {
  try {
    const data = await attendanceService.getAttendanceDay({
      attendanceDayId: req.params.attendanceDayId,
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

const updateAttendanceDay = async (req, res) => {
  try {
    const data = await attendanceService.updateAttendanceDay({
      actor: req.user,
      organizationId: req.orgId,
      attendanceDayId: req.params.attendanceDayId,
      clockInAt: req.body.clockInAt,
      clockOutAt: req.body.clockOutAt,
      breaks: req.body.breaks,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listChangeRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await attendanceService.listChangeRequests({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      status: req.query.status,
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

const approveChangeRequest = async (req, res) => {
  try {
    const data = await attendanceService.approveChangeRequest({
      actor: req.user,
      organizationId: req.orgId,
      requestId: req.params.requestId,
      managerStaffId: req.staffProfile?._id || null,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_change_request_approved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const rejectChangeRequest = async (req, res) => {
  try {
    const data = await attendanceService.rejectChangeRequest({
      actor: req.user,
      organizationId: req.orgId,
      requestId: req.params.requestId,
      managerStaffId: req.staffProfile?._id || null,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_change_request_rejected",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const approveRoster = async (req, res) => {
  try {
    const data = await attendanceService.approveRosterForDay({
      actor: req.user,
      organizationId: req.orgId,
      attendanceDayId: req.params.attendanceDayId,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_roster_approved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const rejectRoster = async (req, res) => {
  try {
    const data = await attendanceService.rejectRosterForDay({
      actor: req.user,
      organizationId: req.orgId,
      attendanceDayId: req.params.attendanceDayId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "attendance_roster_rejected",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const lateCheckInsReport = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { from, to, timezone, branchId, kpis, rows, meta } =
      await attendanceService.lateCheckInsReport({
        actor: req.user,
        organizationId: req.orgId,
        branchId: req.query.branchId,
        departmentId: req.query.departmentId,
        from: req.query.from,
        to: req.query.to,
        keyword: req.query.keyword,
        presenceStatus: req.query.presenceStatus,
        page,
        limit,
        skip,
      });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { from, to, timezone, branchId, kpis, rows },
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const sicknessRateReport = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const result = await attendanceService.sicknessRateReport({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      departmentId: req.query.departmentId,
      from: req.query.from,
      to: req.query.to,
      keyword: req.query.keyword,
      format: req.query.format,
      page,
      limit,
      skip,
    });

    if (result.csv != null) {
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.status(200).send(result.csv);
    }

    const { from, to, timezone, branchId, kpis, rows, meta } = result;
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { from, to, timezone, branchId, kpis, rows },
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const staffHoursSummary = async (req, res) => {
  try {
    const data = await attendanceService.staffHoursSummary({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      departmentId: req.query.departmentId,
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
  listAttendanceDays,
  listAttendanceRota,
  attendanceReport,
  staffHoursSummary,
  sicknessRateReport,
  lateCheckInsReport,
  getAttendanceDay,
  updateAttendanceDay,
  listChangeRequests,
  approveChangeRequest,
  rejectChangeRequest,
  approveRoster,
  rejectRoster,
};
