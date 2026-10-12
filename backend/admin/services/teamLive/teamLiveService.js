const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { AppError } = require("@services/_errors/AppError");
const { Shift } = require("@models/Shift");
const { AttendanceDay } = require("@models/AttendanceDay");
const { LeaveRequest } = require("@models/LeaveRequest");
const { Branch } = require("@models/Branch");
const {
  ShiftStatus,
  PresenceStatus,
  PunctualityStatus,
  LeaveType,
  LeaveRequestStatus,
  StaffProfileStatus,
  MembershipRole,
} = require("@models/domainEnums");
const { StaffProfile } = require("@models/StaffProfile");
const {
  actorStanding,
  resolveSubordinates,
  MANAGER_ROLES,
} = require("@adminServices/staff/staffAccess");
const { listTeamActivity } = require("./teamActivityQuery");

const DEFAULT_TZ = "Europe/London";
const PERIODS = ["daily", "weekly", "monthly"];

const toOid = (value) => new mongoose.Types.ObjectId(String(value));

const resolvePeriod = (period, tz) => {
  const key = String(period || "daily").toLowerCase();
  if (!PERIODS.includes(key)) throw new AppError("invalid_period", 400);

  const now = moment.tz(tz);
  if (key === "weekly") {
    return {
      period: key,
      from: now.clone().startOf("isoWeek"),
      to: now.clone().endOf("isoWeek"),
    };
  }
  if (key === "monthly") {
    return {
      period: key,
      from: now.clone().startOf("month"),
      to: now.clone().endOf("month"),
    };
  }
  return {
    period: key,
    from: now.clone().startOf("day"),
    to: now.clone().endOf("day"),
  };
};

const utcDay = (dayMoment) =>
  new Date(`${dayMoment.format("YYYY-MM-DD")}T00:00:00.000Z`);

const loadTeamIds = async ({ actor, organizationId, standing }) => {
  if (MANAGER_ROLES.includes(standing.role)) {
    const filter = {
      organizationId,
      status: StaffProfileStatus.ACTIVE,
    };
    if (
      standing.role === MembershipRole.SITE_MANAGER &&
      standing.branchId
    ) {
      filter.branchId = standing.branchId;
    }
    const rows = await StaffProfile.find(filter).select("_id").lean();
    return rows.map((row) => row._id);
  }

  const rows = await resolveSubordinates({
    userId: actor._id,
    organizationId,
  });
  return rows
    .filter((row) => !row.status || row.status === StaffProfileStatus.ACTIVE)
    .map((row) => row._id);
};

const loadTimezone = async (standing) => {
  if (!standing.branchId) return DEFAULT_TZ;
  const branch = await Branch.findById(standing.branchId)
    .select("timezone")
    .lean();
  return branch?.timezone || DEFAULT_TZ;
};

const emptyCounts = (teamSize) => ({
  teamSize,
  onSite: 0,
  onShift: 0,
  checkedIn: 0,
  late: 0,
  sick: 0,
});

const loadTeamCounts = async ({ teamIds, from, to, period, tz }) => {
  const teamSize = teamIds.length;
  if (!teamSize) return emptyCounts(0);

  const ids = teamIds.map(toOid);
  const fromDate = from.toDate();
  const toDate = to.toDate();
  const fromWork = utcDay(from);
  const toWork = utcDay(to);
  const todayWork = utcDay(moment.tz(tz || DEFAULT_TZ));

  const [shiftResult, attendanceResult, sickResult] = await Promise.all([
    Shift.aggregate([
      {
        $match: {
          staffId: { $in: ids },
          status: { $in: [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED] },
          startsAt: { $lt: toDate },
          endsAt: { $gt: fromDate },
        },
      },
      { $group: { _id: "$staffId" } },
      { $count: "count" },
    ]),
    AttendanceDay.aggregate([
      {
        $match: {
          staffId: { $in: ids },
          workDate: { $gte: fromWork, $lte: toWork },
        },
      },
      {
        $facet: {
          checkedInPeriod: [
            { $group: { _id: "$staffId" } },
            { $count: "count" },
          ],
          onSite: [
            {
              $match: {
                workDate: todayWork,
                presenceStatus: {
                  $in: [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK],
                },
              },
            },
            { $group: { _id: "$staffId" } },
            { $count: "count" },
          ],
          late: [
            { $match: { punctualityStatus: PunctualityStatus.LATE } },
            { $count: "count" },
          ],
        },
      },
    ]),
    LeaveRequest.aggregate([
      {
        $match: {
          staffId: { $in: ids },
          leaveType: LeaveType.SICK,
          status: {
            $in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.CLOSED],
          },
          startDate: { $lte: toDate },
          endDate: { $gte: fromDate },
        },
      },
      { $group: { _id: null, count: { $sum: "$totalDays" } } },
    ]),
  ]);

  const facet = attendanceResult[0] || {};
  const onSite = facet.onSite?.[0]?.count || 0;
  const checkedInPeriod = facet.checkedInPeriod?.[0]?.count || 0;

  return {
    teamSize,
    onSite,
    onShift: shiftResult[0]?.count || 0,
    checkedIn: period === "daily" ? onSite : checkedInPeriod,
    late: facet.late?.[0]?.count || 0,
    sick: sickResult[0]?.count || 0,
  };
};

const getTeamLive = async ({ actor, organizationId, period: periodQuery }) => {
  const standing = await actorStanding(actor, organizationId);
  const [teamIds, tz] = await Promise.all([
    loadTeamIds({ actor, organizationId, standing }),
    loadTimezone(standing),
  ]);
  const { period, from, to } = resolvePeriod(periodQuery, tz);
  const counts = await loadTeamCounts({ teamIds, from, to, period, tz });

  return { period, counts };
};

const getTeamLiveActivity = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const teamIds = await loadTeamIds({ actor, organizationId, standing });
  return listTeamActivity({ staffIds: teamIds, page, limit, skip });
};

module.exports = { getTeamLive, getTeamLiveActivity };
