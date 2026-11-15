const mongoose = require("mongoose");
const moment = require("moment-timezone");
const {
  PresenceStatus,
  LeaveType,
  LeaveRequestStatus,
  ShiftStatus,
  DocumentAudience,
  StaffProfileStatus,
} = require("@models/domainEnums");
const { StaffProfile } = require("@models/StaffProfile");
const { JobTitle } = require("@models/JobTitle");
const { Department } = require("@models/Department");
const { Branch } = require("@models/Branch");
const { AttendanceDay } = require("@models/AttendanceDay");
const { LeaveEntitlement } = require("@models/LeaveEntitlement");
const { LeaveRequest } = require("@models/LeaveRequest");
const { Document } = require("@models/Document");
const { DocumentSignature } = require("@models/DocumentSignature");
const attendanceService = require("@adminServices/attendance/attendanceService");
const staffDashboardSettingsService = require("@adminServices/organizations/staffDashboardSettingsService");
const {
  listStaffShiftsInRange,
  listOpenShifts,
} = require("@adminServices/rota/shiftService");
const { myCompliance } = require("@adminServices/staff/staffComplianceService");
const { entitlementYearFromDate } = require("@adminServices/leave/leaveService");
const { AppError } = require("@services/_errors/AppError");

const DEFAULT_TZ = "Europe/London";
const DAY_FORMAT = "YYYY-MM-DD";
const NEXT_SHIFT_DAYS = 3;
const WEEK_SHIFTS_LIMIT = 200;
const DEFAULT_EARLY_CLOCK_IN_MINUTES = 60;
const DEFAULT_UNPAID_BREAK_BANDS = [
  { minShiftHours: 6, unpaidBreakHours: 0.5 },
  { minShiftHours: 12, unpaidBreakHours: 1 },
];

const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;

const oid = (value) => new mongoose.Types.ObjectId(String(value));

const remainingDaysOf = (entitlement) => {
  if (!entitlement) return 0;
  return (
    entitlement.entitlementDays +
    entitlement.carriedOverDays -
    entitlement.takenDays -
    entitlement.pendingDays
  );
};

const unpaidBreakMinutes = (shiftHours, settings = {}) => {
  if (settings.paidBreaks) return 0;
  const bands = (
    settings.breakBands?.length
      ? settings.breakBands
      : DEFAULT_UNPAID_BREAK_BANDS
  ).filter((band) => Number(band.minShiftHours) <= shiftHours);
  if (!bands.length) return 0;
  const best = bands.reduce((a, b) =>
    Number(a.minShiftHours) >= Number(b.minShiftHours) ? a : b
  );
  return Math.round(Number(best.unpaidBreakHours) * 60);
};

const weekRange = (anchor, tz, weeksAhead = 0) => {
  const start = moment.tz(anchor, tz).startOf("isoWeek").add(weeksAhead, "weeks");
  const end = start.clone().endOf("isoWeek");
  return { from: start.toDate(), to: end.toDate() };
};

const shiftMinutes = (shift) =>
  Math.max(0, (new Date(shift.endsAt) - new Date(shift.startsAt)) / 60000);

const loadHomeStaff = async ({ userId, organizationId }) => {
  const [staff] = await StaffProfile.aggregate([
    {
      $match: {
        userId: oid(userId),
        organizationId: oid(organizationId),
        status: StaffProfileStatus.ACTIVE,
      },
    },
    {
      $lookup: {
        from: Department.collection.name,
        localField: "departmentIds",
        foreignField: "_id",
        pipeline: [
          { $project: { name: 1, sortOrder: 1 } },
          { $sort: { sortOrder: 1 } },
        ],
        as: "_departments",
      },
    },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        pipeline: [
          {
            $project: { name: 1, code: 1, timezone: 1, settings: 1 },
          },
          { $limit: 1 },
        ],
        as: "_branch",
      },
    },
    {
      $project: {
        branchId: 1,
        jobTitleId: 1,
        contractedWeeklyHours: 1,
        departmentName: {
          $ifNull: [{ $arrayElemAt: ["$_departments.name", 0] }, ""],
        },
        _branch: { $arrayElemAt: ["$_branch", 0] },
      },
    },
  ]);
  if (!staff) throw new AppError("staff_profile_not_found", 403);

  const branch = staff._branch || null;
  const jobTitle = staff.jobTitleId
    ? await JobTitle.findById(staff.jobTitleId).select("name").lean()
    : null;

  return {
    staffId: staff._id,
    branchId: staff.branchId,
    timezone: branch?.timezone || DEFAULT_TZ,
    branchSettings: branch?.settings || {},
    site: shapeSite(branch),
    jobTitle: jobTitle?.name || "",
    departmentName: staff.departmentName || "",
    contractedWeeklyHours: Number(staff.contractedWeeklyHours) || 0,
  };
};

const shapeBreakBands = (bands) => {
  const source =
    Array.isArray(bands) && bands.length ? bands : DEFAULT_UNPAID_BREAK_BANDS;
  return [...source]
    .map((band) => {
      const minShiftHours = Number(band.minShiftHours);
      const unpaidBreakHours = Number(band.unpaidBreakHours);
      return {
        minShiftHours,
        unpaidBreakHours,
        unpaidBreakMinutes: Math.round(unpaidBreakHours * 60),
      };
    })
    .sort((a, b) => b.minShiftHours - a.minShiftHours);
};

const shapeSite = (branch) => {
  if (!branch) return null;
  const settings = branch.settings || {};
  return {
    _id: branch._id,
    name: branch.name || "",
    code: branch.code || "",
    timezone: branch.timezone || DEFAULT_TZ,
    settings: {
      enableBreaks: Boolean(settings.enableBreaks),
      paidBreaks: Boolean(settings.paidBreaks),
      allowPhoneCheckIn: Boolean(settings.allowPhoneCheckIn),
      lateGraceMinutes:
        settings.lateGraceMinutes === undefined
          ? 5
          : Number(settings.lateGraceMinutes),
      enableLeaveRequests: settings.enableLeaveRequests !== false,
      maxShiftHours:
        Number(settings.maxShiftHours) >= 1 ? Number(settings.maxShiftHours) : 12,
      earlyClockInMinutes:
        Number(settings.earlyClockInMinutes) >= 0
          ? Number(settings.earlyClockInMinutes)
          : DEFAULT_EARLY_CLOCK_IN_MINUTES,
      breakBands: shapeBreakBands(settings.breakBands),
    },
  };
};

const overlaps = (shift, from, to) =>
  new Date(shift.startsAt) < to && new Date(shift.endsAt) > from;

const inStartRange = (shift, from, to) => {
  const start = new Date(shift.startsAt);
  return start >= from && start <= to;
};

const scheduledHours = (shifts) =>
  hours(shifts.reduce((sum, shift) => sum + shiftMinutes(shift), 0));

const soFarHoursOfWeek = async ({ staffId, from, to, now }) => {
  const rows = await AttendanceDay.aggregate([
    {
      $match: {
        staffId,
        workDate: { $gte: from, $lte: to },
      },
    },
    {
      $project: {
        workedMinutes: 1,
        clockInAt: 1,
        clockOutAt: 1,
        presenceStatus: 1,
      },
    },
  ]);
  const minutes = rows.reduce((sum, row) => {
    const open =
      !row.clockOutAt && row.presenceStatus !== PresenceStatus.CHECKED_OUT;
    const value = open
      ? Math.max(0, Math.round((now - new Date(row.clockInAt)) / 60000))
      : row.workedMinutes || 0;
    return sum + value;
  }, 0);
  return hours(minutes);
};

const documentsWaiting = async ({ organizationId, branchId, staffId }) => {
  const rows = await Document.aggregate([
    {
      $match: {
        organizationId: oid(organizationId),
        requiresSignature: true,
        audiences: DocumentAudience.STAFF,
        $or: [{ branchId }, { branchId: null }],
      },
    },
    {
      $lookup: {
        from: DocumentSignature.collection.name,
        localField: "currentVersionId",
        foreignField: "documentVersionId",
        as: "signatures",
      },
    },
    { $match: { "signatures.signerStaffId": { $ne: staffId } } },
    { $sort: { createdAt: 1 } },
    { $project: { createdAt: 1 } },
  ]);
  return {
    waiting: rows.length,
    firstDueAt: rows[0]?.createdAt || null,
  };
};

const annualLeave = async (staffId) => {
  const [entitlement, pending] = await Promise.all([
    LeaveEntitlement.findOne({
      staffId,
      year: entitlementYearFromDate(),
      leaveType: LeaveType.ANNUAL,
    }).lean(),
    LeaveRequest.countDocuments({
      staffId,
      status: LeaveRequestStatus.PENDING,
    }),
  ]);
  return {
    remainingDays: remainingDaysOf(entitlement),
    takenDays:
      (entitlement?.takenDays || 0) + (entitlement?.pendingDays || 0),
    pendingRequests: pending,
  };
};

const nextShiftItems = ({ shifts, timezone, now }) => {
  const byDate = new Map();
  shifts.forEach((shift) => {
    const date = moment.tz(shift.startsAt, timezone).format(DAY_FORMAT);
    const list = byDate.get(date) || [];
    list.push({ startsAt: shift.startsAt, endsAt: shift.endsAt });
    byDate.set(date, list);
  });

  const start = moment.tz(now, timezone).startOf("day").add(1, "day");
  return Array.from({ length: NEXT_SHIFT_DAYS }, (_, index) => {
    const day = start.clone().add(index, "days");
    const date = day.format(DAY_FORMAT);
    const slots = byDate.get(date) || [];
    if (!slots.length) return { date, off: true, startsAt: null, endsAt: null };
    const first = slots[0];
    return {
      date,
      off: false,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
    };
  });
};

const slimShift = (shift, activeId) => ({
  _id: shift._id,
  startsAt: shift.startsAt,
  endsAt: shift.endsAt,
  status: shift.status,
  branchId: shift.branchId,
  isActive: Boolean(activeId) && String(shift._id) === String(activeId),
});

const pickActiveShift = (shifts, now, earlyClockInMinutes) => {
  const windowMinutes =
    Number(earlyClockInMinutes) >= 0
      ? Number(earlyClockInMinutes)
      : DEFAULT_EARLY_CLOCK_IN_MINUTES;
  const earliestClockIn = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const eligible = shifts.filter(
    (shift) =>
      shift.status === ShiftStatus.SCHEDULED &&
      new Date(shift.startsAt) <= earliestClockIn &&
      new Date(shift.endsAt) >= now
  );
  if (!eligible.length) return null;
  return eligible.reduce((latest, shift) =>
    new Date(shift.startsAt) >= new Date(latest.startsAt) ? shift : latest
  );
};

const todayCard = ({
  shifts,
  activeShift,
  attendance,
  jobTitle,
  departmentName,
  branchSettings,
  timezone,
  now,
}) => {
  const shift = activeShift || null;
  const presence = attendance?.presenceStatus || null;
  let unpaidBreakMinutesValue = 0;
  let startsInMinutes = null;
  if (shift?.startsAt && shift?.endsAt) {
    const shiftHours = shiftMinutes(shift) / 60;
    unpaidBreakMinutesValue = unpaidBreakMinutes(shiftHours, branchSettings);
    startsInMinutes = Math.round((new Date(shift.startsAt) - now) / 60000);
  }
  const clockInEligible = Boolean(shift);

  return {
    date: moment.tz(now, timezone).format(DAY_FORMAT),
    startsAt: shift?.startsAt || null,
    endsAt: shift?.endsAt || null,
    jobTitle,
    departmentName: departmentName || "",
    unpaidBreakMinutes: unpaidBreakMinutesValue,
    startsInMinutes,
    clockInEligible,
    presenceStatus: presence,
    primaryAction: todayAction(presence, true, attendance, clockInEligible),
    shifts: shifts.map((row) => slimShift(row, shift?._id)),
    activeShift: {
      shift: shift ? slimShift(shift, shift._id) : null,
      clockInEligible,
    },
    attendance,
  };
};

const todayAction = (presence, checkInVisible, attendance, clockInEligible) => {
  if (!checkInVisible) return null;
  if (presence === PresenceStatus.ON_BREAK) return "endBreak";
  if (presence === PresenceStatus.ON_SITE) {
    const hasCompletedBreak = (attendance?.breaks || []).some(
      (segment) => segment.breakOutAt
    );
    return hasCompletedBreak ? "clockOut" : "startBreak";
  }
  if (presence === PresenceStatus.ON_LEAVE) return null;
  if (clockInEligible) return "clockIn";
  if (!presence) return "clockIn";
  return null;
};

const percentOf = (score) => score?.percent ?? 0;

const getStaffAppDashboard = async ({ actor, organizationId, now = new Date() }) => {
  const staff = await loadHomeStaff({
    userId: actor._id,
    organizationId,
  });

  const thisWeek = weekRange(now, staff.timezone, 0);
  const nextWeek = weekRange(now, staff.timezone, 1);
  const todayStart = moment.tz(now, staff.timezone).startOf("day").toDate();
  const todayEnd = moment.tz(now, staff.timezone).endOf("day").toDate();
  const nextStripFrom = moment
    .tz(now, staff.timezone)
    .startOf("day")
    .add(1, "day")
    .toDate();
  const nextStripTo = moment
    .tz(now, staff.timezone)
    .startOf("day")
    .add(NEXT_SHIFT_DAYS, "days")
    .endOf("day")
    .toDate();

  const [
    visibility,
    attendance,
    rosterShifts,
    leave,
    standing,
    openShifts,
    documents,
    soFarHours,
  ] = await Promise.all([
    staffDashboardSettingsService.getStaffDashboardSettingsForStaff({
      userId: actor._id,
      organizationId,
    }),
    attendanceService.getStaffAttendanceSnapshot({
      staffId: staff.staffId,
      now,
      branchSettings: staff.branchSettings,
    }),
    listStaffShiftsInRange({
      staffId: staff.staffId,
      organizationId,
      from: todayStart,
      to: nextWeek.to,
      limit: WEEK_SHIFTS_LIMIT,
    }),
    annualLeave(staff.staffId),
    myCompliance({ actor, organizationId }),
    listOpenShifts({ userId: actor._id, organizationId, from: now }),
    documentsWaiting({
      organizationId,
      branchId: staff.branchId,
      staffId: staff.staffId,
    }),
    soFarHoursOfWeek({
      staffId: staff.staffId,
      from: thisWeek.from,
      to: thisWeek.to,
      now,
    }),
  ]);

  const todayShifts = rosterShifts.filter((shift) =>
    overlaps(shift, todayStart, todayEnd)
  );
  const thisWeekShifts = rosterShifts.filter((shift) =>
    overlaps(shift, thisWeek.from, thisWeek.to)
  );
  const nextWeekShifts = rosterShifts.filter((shift) =>
    overlaps(shift, nextWeek.from, nextWeek.to)
  );
  const stripShifts = rosterShifts.filter((shift) =>
    inStartRange(shift, nextStripFrom, nextStripTo)
  );
  const activeShift = pickActiveShift(
    rosterShifts,
    now,
    staff.branchSettings?.earlyClockInMinutes
  );

  const checkInVisible = Boolean(visibility.cards?.checkIn);
  const todayShaped = todayCard({
    shifts: todayShifts,
    activeShift,
    attendance,
    jobTitle: staff.jobTitle,
    departmentName: staff.departmentName,
    branchSettings: staff.branchSettings,
    timezone: staff.timezone,
    now,
  });
  todayShaped.primaryAction = todayAction(
    todayShaped.presenceStatus,
    checkInVisible,
    attendance,
    todayShaped.clockInEligible
  );

  return {
    visibility,
    site: staff.site,
    today: todayShaped,
    nextShifts: {
      items: nextShiftItems({
        shifts: stripShifts,
        timezone: staff.timezone,
        now,
      }),
      thisWeekHours: scheduledHours(thisWeekShifts),
      nextWeekHours: scheduledHours(nextWeekShifts),
    },
    weeklyHours: {
      contractedHours: staff.contractedWeeklyHours,
      soFarHours,
      wholeWeekHours: scheduledHours(thisWeekShifts),
      hourlyRate: null,
      earnedThisWeek: null,
    },
    shiftClaims: { available: openShifts.length },
    leave,
    compliance: {
      supervision: percentOf(standing.supervision),
      appraisal: percentOf(standing.appraisal),
      competency: percentOf(standing.competency),
      training: percentOf(standing.training),
      fireDrills: percentOf(standing.fireDrills),
      compartmentDrills: percentOf(standing.compartmentDrills),
    },
    documents,
    announcements: { unread: 0, items: [] },
  };
};

module.exports = { getStaffAppDashboard };
