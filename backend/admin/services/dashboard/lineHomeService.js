const moment = require("moment-timezone");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { AppError } = require("@services/_errors/AppError");
const { Organization } = require("@models/Organization");
const { StaffProfile } = require("@models/StaffProfile");
const { AttendanceDay } = require("@models/AttendanceDay");
const { LeaveRequest } = require("@models/LeaveRequest");
const { Shift } = require("@models/Shift");
const { ShiftClaim } = require("@models/ShiftClaim");
const { Resident } = require("@models/Resident");
const { SupervisionRecord } = require("@models/SupervisionRecord");
const {
  MembershipRole,
  PunctualityStatus,
  LeaveRequestStatus,
  ShiftStatus,
  ShiftClaimStatus,
  AdmissionStatus,
  ComplianceMeetingStatus,
  StaffProfileStatus,
} = require("@models/domainEnums");
const { actorStanding } = require("@adminServices/staff/staffAccess");
const {
  loadTeamIds,
  loadTimezone,
  loadTeamCounts,
  resolvePeriod,
} = require("@adminServices/teamLive/teamLiveService");
const {
  listLeaveRegisterDays,
  summaryFromCounts,
} = require("@adminServices/attendance/attendanceService");
const { staffNamesById } = require("@adminServices/siteLive/siteActivityQuery");
const { getAttention } = require("@adminServices/family/familyWallActivityService");
const { supervisionStanding } = require("@adminServices/supervision/supervisionSchedule");
const { effectiveIntervals } = require("@adminServices/appraisal/cycle");
const { User } = require("@models/UserModel");
const { sickFacet } = require("./lineHomeTodayService");

const ROTA_WINDOW_DAYS = 14;

const thisMonthOf = async ({ teamIds, from, to }) => {
  const fromDay = from.format("YYYY-MM-DD");
  const toDay = to.format("YYYY-MM-DD");
  const fromWork = new Date(`${fromDay}T00:00:00.000Z`);
  const toWork = new Date(`${toDay}T00:00:00.000Z`);
  const ids = teamIds.map((id) => toObjectId(id));

  if (!ids.length) {
    return {
      attendancePercent: 0,
      onTimePercent: 0,
      sicknessPercent: 0,
      mostLate: null,
    };
  }

  const [attendance, leaveDays] = await Promise.all([
    AttendanceDay.aggregate([
      {
        $match: {
          staffId: { $in: ids },
          workDate: { $gte: fromWork, $lte: toWork },
        },
      },
      {
        $facet: {
          punctuality: [
            { $group: { _id: "$punctualityStatus", count: { $sum: 1 } } },
          ],
          mostLate: [
            { $match: { punctualityStatus: PunctualityStatus.LATE } },
            { $group: { _id: "$staffId", lateDays: { $sum: 1 } } },
            { $sort: { lateDays: -1, _id: 1 } },
            { $limit: 1 },
          ],
        },
      },
    ]),
    listLeaveRegisterDays({ staffIds: ids, from: fromDay, to: toDay }),
  ]);

  const facet = attendance[0] || {};
  const countOf = (status) =>
    (facet.punctuality || []).find((row) => row._id === status)?.count || 0;
  const onTime = countOf(PunctualityStatus.ON_TIME);
  const late = countOf(PunctualityStatus.LATE);
  const summary = summaryFromCounts(
    { onTime, late, unscheduled: countOf(PunctualityStatus.UNSCHEDULED) },
    leaveDays,
  );
  const timed = onTime + late;
  const top = facet.mostLate?.[0];
  const names = top ? await staffNamesById([top._id]) : new Map();

  return {
    attendancePercent: summary.attendanceRate,
    onTimePercent: timed ? Math.round((100 * onTime) / timed) : 0,
    sicknessPercent: (() => {
      const denom =
        summary.onTimeCount +
        summary.lateCount +
        summary.sickDays +
        summary.absenceDays;
      return denom ? Math.round((1000 * summary.sickDays) / denom) / 10 : 0;
    })(),
    mostLate: top
      ? {
          staffId: String(top._id),
          name: names.get(String(top._id)) || "",
          lateDays: top.lateDays,
        }
      : null,
  };
};

const leavePendingOf = (ids) =>
  ids.length
    ? LeaveRequest.countDocuments({
        staffId: { $in: ids },
        status: LeaveRequestStatus.PENDING,
      })
    : 0;

const shiftClaimOf = async (ids) => {
  if (!ids.length) return { pending: 0, preview: null };

  const [facet] = await ShiftClaim.aggregate([
    { $match: { staffId: { $in: ids }, status: ShiftClaimStatus.PENDING } },
    { $sort: { createdAt: 1 } },
    {
      $facet: {
        total: [{ $count: "count" }],
        first: [
          { $limit: 1 },
          {
            $lookup: {
              from: Shift.collection.name,
              localField: "shiftId",
              foreignField: "_id",
              as: "shift",
            },
          },
          {
            $lookup: {
              from: StaffProfile.collection.name,
              localField: "staffId",
              foreignField: "_id",
              as: "staff",
            },
          },
          {
            $lookup: {
              from: User.collection.name,
              localField: "staff.userId",
              foreignField: "_id",
              as: "user",
            },
          },
        ],
      },
    },
  ]);

  const row = facet?.first?.[0];
  const shift = row?.shift?.[0];
  return {
    pending: facet?.total?.[0]?.count || 0,
    preview: row
      ? {
          staffId: String(row.staffId),
          name: row.user?.[0]?.name || "",
          startsAt: shift?.startsAt || null,
          endsAt: shift?.endsAt || null,
        }
      : null,
  };
};

const supervisionsOf = async ({ ids, organizationId, tz, now }) => {
  if (!ids.length) {
    return { dueThisMonth: 0, overdue: 0, overdueName: null };
  }

  const orgOid = toObjectId(organizationId);
  const [staff, [org], meetings] = await Promise.all([
    StaffProfile.aggregate([
      { $match: { _id: { $in: ids } } },
      {
        $lookup: {
          from: User.collection.name,
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $project: {
          startDate: 1,
          supervisionIntervalMonths: 1,
          name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
        },
      },
    ]),
    Organization.aggregate([
      { $match: { _id: orgOid } },
      { $project: { settings: 1 } },
    ]),
    SupervisionRecord.aggregate([
      {
        $match: {
          organizationId: orgOid,
          staffId: { $in: ids },
          status: { $ne: ComplianceMeetingStatus.CANCELLED },
        },
      },
      { $project: { staffId: 1, status: 1, completedAt: 1, scheduledAt: 1 } },
    ]),
  ]);

  const settings = org?.settings || {};
  const monthEnd = moment.tz(now, tz).endOf("month");
  const standings = staff.map((member) => ({
    name: member.name,
    standing: supervisionStanding({
      startDate: member.startDate,
      intervalMonths: effectiveIntervals(member, settings).supervisionMonths,
      meetings: meetings.filter(
        (row) => String(row.staffId) === String(member._id),
      ),
      timezone: tz,
      checkDate: now,
    }),
  }));

  const overdueRow = standings.find((row) => row.standing.badge === "overdue");
  return {
    dueThisMonth: standings.filter(
      (row) =>
        row.standing.badge !== "overdue" &&
        moment(row.standing.nextDueAt).isSameOrBefore(monthEnd),
    ).length,
    overdue: standings.filter((row) => row.standing.badge === "overdue").length,
    overdueName: overdueRow?.name || null,
  };
};

const rotaWindowOf = async ({ organizationId, branchId, tz, now }) => {
  const from = moment.tz(now, tz).startOf("day");
  const tonightEnd = from.clone().endOf("day");
  const to = from.clone().add(ROTA_WINDOW_DAYS, "days").endOf("day");
  const orgOid = toObjectId(organizationId);
  const branchOid = toObjectId(branchId);

  const [facet] = await Shift.aggregate([
    {
      $match: {
        organizationId: orgOid,
        branchId: branchOid,
        status: ShiftStatus.OPEN,
        startsAt: { $gte: from.toDate(), $lte: to.toDate() },
      },
    },
    {
      $facet: {
        openTonight: [
          { $match: { startsAt: { $lte: tonightEnd.toDate() } } },
          { $count: "count" },
        ],
        days: [
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$startsAt",
                  timezone: tz,
                },
              },
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  return {
    openTonight: facet?.openTonight?.[0]?.count || 0,
    daysToBook: facet?.days?.[0]?.count || 0,
  };
};

const emptyOwnShifts = () => ({
  next: null,
  upcoming: 0,
  hoursThisWeek: 0,
  pendingLeave: 0,
});

const ownShiftsOf = async ({ actor, organizationId, tz, now }) => {
  const profile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId: toObjectId(organizationId),
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id")
    .lean();
  if (!profile) return emptyOwnShifts();

  const staffId = profile._id;
  const week = resolvePeriod("weekly", tz);
  const from = moment.tz(now, tz).startOf("day");
  const upcomingTo = from.clone().add(ROTA_WINDOW_DAYS, "days").endOf("day");
  const mine = {
    staffId,
    status: { $in: [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED] },
  };

  const [facet, pendingLeave] = await Promise.all([
    Shift.aggregate([
      { $match: mine },
      {
        $facet: {
          next: [
            { $match: { startsAt: { $gte: now }, status: ShiftStatus.SCHEDULED } },
            { $sort: { startsAt: 1 } },
            { $limit: 1 },
            { $project: { _id: 0, shiftId: "$_id", startsAt: 1, endsAt: 1 } },
          ],
          upcoming: [
            {
              $match: {
                startsAt: { $gte: from.toDate(), $lte: upcomingTo.toDate() },
              },
            },
            { $count: "count" },
          ],
          weekHours: [
            {
              $match: {
                startsAt: { $lte: week.to.toDate() },
                endsAt: { $gte: week.from.toDate() },
              },
            },
            {
              $group: {
                _id: null,
                minutes: {
                  $sum: {
                    $divide: [{ $subtract: ["$endsAt", "$startsAt"] }, 60000],
                  },
                },
              },
            },
          ],
        },
      },
    ]),
    LeaveRequest.countDocuments({
      staffId,
      status: LeaveRequestStatus.PENDING,
    }),
  ]);

  const row = facet[0] || {};
  const minutes = row.weekHours?.[0]?.minutes || 0;
  return {
    next: row.next?.[0] || null,
    upcoming: row.upcoming?.[0]?.count || 0,
    hoursThisWeek: Math.round((minutes / 60) * 10) / 10,
    pendingLeave,
  };
};

const getLineHome = async ({ actor, organizationId, now = new Date() }) => {
  const standing = await actorStanding(actor, organizationId);
  if (standing.role !== MembershipRole.LINE_MANAGER) {
    throw new AppError("insufficient_role", 403);
  }
  if (!standing.branchId) throw new AppError("branch_scope_required", 400);

  const tz = await loadTimezone(standing);
  const teamIds = await loadTeamIds({ actor, organizationId, standing });
  const ids = teamIds.map((id) => toObjectId(id));
  const daily = resolvePeriod("daily", tz);
  const monthly = resolvePeriod("monthly", tz);
  const orgOid = toObjectId(organizationId);
  const branchOid = toObjectId(standing.branchId);

  const [
    today,
    thisMonth,
    leavePending,
    shiftClaim,
    supervisions,
    family,
    rota,
    restricted,
    ownShifts,
    sickToday,
  ] =
    await Promise.all([
      loadTeamCounts({
        teamIds,
        from: daily.from,
        to: daily.to,
        period: daily.period,
        tz,
      }),
      thisMonthOf({ teamIds, from: monthly.from, to: monthly.to }),
      leavePendingOf(ids),
      shiftClaimOf(ids),
      supervisionsOf({ ids, organizationId, tz, now }),
      getAttention({ organizationId, branchId: standing.branchId }),
      rotaWindowOf({
        organizationId,
        branchId: standing.branchId,
        tz,
        now,
      }),
      Resident.countDocuments({
        organizationId: orgOid,
        branchId: branchOid,
        admissionStatus: AdmissionStatus.ADMITTED,
        restricted: true,
      }),
      ownShiftsOf({ actor, organizationId, tz, now }),
      // Same count as the Today screen's Sick tab: team members off sick today.
      sickFacet({
        ids,
        from: daily.from.toDate(),
        to: daily.to.toDate(),
        includeRows: false,
      }),
    ]);

  return {
    today: {
      onShift: today.onShift,
      checkedIn: today.checkedIn,
      late: today.late,
      onSite: today.onSite,
      sick: sickToday.total,
    },
    thisMonth,
    activity: {
      leave: { pending: leavePending },
      shiftClaim,
      supervisions,
      familyPhotos: { pending: family.pendingUploads.count },
      tempyAgency: { openTonight: rota.openTonight, bids: null },
      teamRota: { windowDays: ROTA_WINDOW_DAYS, daysToBook: rota.daysToBook },
      ownShifts,
      restrictedResidents: { count: restricted },
    },
  };
};

module.exports = { getLineHome };
