const moment = require("moment-timezone");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { StaffProfile } = require("@models/StaffProfile");
const { AttendanceDay } = require("@models/AttendanceDay");
const {
  PunctualityStatus,
  StaffProfileStatus,
} = require("@models/domainEnums");
const Message = require("../../../commonModules/chatModule/models/Message");
const {
  resolveLiveBranchId,
} = require("@adminServices/siteLive/siteLiveService");
const {
  listLeaveRegisterDays,
  summaryFromCounts,
} = require("@adminServices/attendance/attendanceService");
const {
  getAttention,
} = require("@adminServices/family/familyWallActivityService");
const { activityOf } = require("@adminServices/family/familyOverviewService");

const TZ = "Europe/London";
const DAY_FORMAT = "YYYY-MM-DD";

const weekStart = (now) => moment.tz(now, TZ).startOf("isoWeek").toDate();

const lastSevenDays = (now) => {
  const today = moment.tz(now, TZ);
  return Array.from({ length: 7 }, (_, index) =>
    today
      .clone()
      .subtract(6 - index, "days")
      .format(DAY_FORMAT),
  );
};

const attendanceOfDays = async ({ branchId, days }) => {
  const from = days[0];
  const to = days[6];
  const [grouped, staff] = await Promise.all([
    AttendanceDay.aggregate([
      {
        $match: {
          branchId,
          workDate: {
            $gte: new Date(`${from}T00:00:00Z`),
            $lte: new Date(`${to}T00:00:00Z`),
          },
        },
      },
      {
        $group: {
          _id: { workDate: "$workDate", status: "$punctualityStatus" },
          count: { $sum: 1 },
        },
      },
    ]),
    StaffProfile.aggregate([
      {
        $match: { branchId, status: StaffProfileStatus.ACTIVE },
      },
      { $project: { _id: 1 } },
    ]),
  ]);

  const rows = grouped.map((row) => ({
    ...row,
    _id: {
      date: row._id.workDate.toISOString().slice(0, 10),
      status: row._id.status,
    },
  }));
  const countOf = (date, status) =>
    rows
      .filter(
        (row) => (!date || row._id.date === date) && row._id.status === status,
      )
      .reduce((sum, row) => sum + row.count, 0);
  const counts = {
    onTime: countOf(null, PunctualityStatus.ON_TIME),
    late: countOf(null, PunctualityStatus.LATE),
    unscheduled: countOf(null, PunctualityStatus.UNSCHEDULED),
  };
  const leaveDays = await listLeaveRegisterDays({
    staffIds: staff.map((member) => member._id),
    from,
    to,
  });

  return {
    shiftsLogged: rows.reduce((sum, row) => sum + row.count, 0),
    onTime: counts.onTime,
    late: counts.late,
    attendanceRate: summaryFromCounts(counts, leaveDays).attendanceRate,
    chart: days.map((date) => ({
      date,
      onTime: countOf(date, PunctualityStatus.ON_TIME),
      late: countOf(date, PunctualityStatus.LATE),
    })),
  };
};

const messagesSent = async ({ branchId, since }) => {
  const [row] = await Message.aggregate([
    { $match: { branchId, createdAt: { $gte: since } } },
    { $group: { _id: "$broadcastId" } },
    { $count: "count" },
  ]);
  return row?.count ?? 0;
};

const getLineDashboard = async ({
  actor,
  organizationId,
  now = new Date(),
}) => {
  const branchId = toObjectId(
    await resolveLiveBranchId({ actor, organizationId }),
  );
  const since = weekStart(now);

  const [attendance, attention, family, messages] = await Promise.all([
    attendanceOfDays({ branchId, days: lastSevenDays(now) }),
    getAttention({ organizationId, branchId }),
    activityOf({
      scope: { organizationId: toObjectId(organizationId), branchId },
      since,
    }),
    messagesSent({ branchId, since }),
  ]);

  const { chart, ...cards } = attendance;
  return {
    summary: {
      ...cards,
      familyUploadsWaiting: attention.pendingUploads.count,
      wallPostsThisWeek: family.wallPosts,
      messagesSent: messages,
    },
    teamAttendance: chart,
  };
};

module.exports = { getLineDashboard };
