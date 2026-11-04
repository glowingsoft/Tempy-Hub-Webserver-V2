const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { AttendanceDay } = require("@models/AttendanceDay");
const { VisitSession } = require("@models/VisitSession");
const { ExternalPerson } = require("@models/ExternalPerson");
const { Shift } = require("@models/Shift");
const { Department } = require("@models/Department");
const { AttendanceChangeRequest } = require("@models/AttendanceChangeRequest");
const { LeaveRequest } = require("@models/LeaveRequest");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { paginateWithFacet, facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const {
  CheckInMethod,
  PunctualityStatus,
  PresenceStatus,
  ChangeRequestStatus,
  StaffProfileStatus,
  LeaveType,
  LeaveRequestStatus,
  RosterRequestStatus,
  ShiftStatus,
  ExternalPersonType,
} = require("@models/domainEnums");
const {
  getActiveShift,
  getActiveShiftForStaff,
  getShift,
  createScheduledShiftFromAttendance,
} = require("@adminServices/rota/shiftService");
const { toPublicImageUrl } = require("@utils/imageHelper");
const {
  actorStanding,
  assertMayManageStaff,
  assertMayApproveForStaff,
  scopeBranchFilter,
  applyLineManagerStaffScope,
  resolveScopedStaffIds,
} = require("./attendanceAccess");

const DEFAULT_UNPAID_BREAK_BANDS = [
  { minShiftHours: 6, unpaidBreakHours: 0.5 },
  { minShiftHours: 12, unpaidBreakHours: 1 },
];

const REGISTER_LEAVE_TYPES = [
  LeaveType.ANNUAL,
  LeaveType.SICK,
  LeaveType.ABSENCE,
];

const REGISTER_LEAVE_STATUSES = [
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.CLOSED,
];

const CORRECTABLE_FIELDS = ["clockInAt", "clockOutAt", "breaks"];

const ON_SITE_PRESENCE = [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK];

const DEFAULT_TZ = "Europe/London";
const MAX_ROTA_RANGE_DAYS = 56;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const startOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const unpaidBreakMinutesFromRules = (shiftHours, settings = {}) => {
  if (settings.paidBreaks) return 0;
  const bands = (settings.breakBands?.length
    ? settings.breakBands
    : DEFAULT_UNPAID_BREAK_BANDS
  ).filter((band) => Number(band.minShiftHours) <= shiftHours);
  if (!bands.length) return 0;
  const best = bands.reduce((a, b) =>
    Number(a.minShiftHours) >= Number(b.minShiftHours) ? a : b
  );
  return Math.round(Number(best.unpaidBreakHours) * 60);
};

const computeWorkedMinutes = (day, settings = {}) => {
  if (!day.clockOutAt) return null;
  let ms = new Date(day.clockOutAt) - new Date(day.clockInAt);
  const shiftHours = ms / 3600000;

  if (settings.enableBreaks) {
    if (settings.paidBreaks) {
      return Math.max(0, Math.round(ms / 60000));
    }
    ms -= unpaidBreakMinutesFromRules(shiftHours, settings) * 60000;
    return Math.max(0, Math.round(ms / 60000));
  }

  for (const segment of day.breaks || []) {
    if (segment.breakOutAt) {
      ms -= new Date(segment.breakOutAt) - new Date(segment.breakInAt);
    }
  }
  return Math.max(0, Math.round(ms / 60000));
};

const expandLeaveToRegisterDays = (requests, from, to) => {
  const days = [];
  const rangeStart = from ? startOfUtcDay(from) : null;
  const rangeEnd = to ? startOfUtcDay(to) : null;

  for (const request of requests) {
    let cursor = startOfUtcDay(request.startDate);
    const last = startOfUtcDay(request.endDate);
    while (cursor <= last) {
      if ((!rangeStart || cursor >= rangeStart) && (!rangeEnd || cursor <= rangeEnd)) {
        days.push({
          kind: "leave",
          workDate: new Date(cursor),
          staffId: request.staffId,
          presenceStatus: PresenceStatus.ON_LEAVE,
          leaveType: request.leaveType,
          leaveRequestId: request._id,
          source: request.source,
          ...(request.staff ? { staff: request.staff } : {}),
        });
      }
      cursor = new Date(cursor.getTime() + 86400000);
    }
  }
  return days;
};

const listLeaveRegisterDays = async ({ staffIds, from, to }) => {
  if (!staffIds?.length) return [];

  const match = {
    staffId: { $in: staffIds },
    leaveType: { $in: REGISTER_LEAVE_TYPES },
    status: { $in: REGISTER_LEAVE_STATUSES },
  };

  if (from || to) {
    if (from) match.endDate = { ...(match.endDate || {}), $gte: startOfUtcDay(from) };
    if (to) match.startDate = { ...(match.startDate || {}), $lte: startOfUtcDay(to) };
  }

  const requests = await LeaveRequest.aggregate([
    { $match: match },
    {
      $lookup: {
        from: StaffProfile.collection.name,
        localField: "staffId",
        foreignField: "_id",
        as: "_staff",
      },
    },
    { $unwind: { path: "$_staff", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_staff.userId",
        foreignField: "_id",
        as: "_user",
      },
    },
    { $unwind: { path: "$_user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        staffId: 1,
        startDate: 1,
        endDate: 1,
        leaveType: 1,
        source: 1,
        staff: {
          _id: "$_staff._id",
          employeeCode: "$_staff.employeeCode",
          name: { $ifNull: ["$_user.name", ""] },
          email: { $ifNull: ["$_user.email", ""] },
          photoUrl: { $ifNull: ["$_staff.photoUrl", ""] },
        },
      },
    },
  ]);

  return expandLeaveToRegisterDays(requests, from, to);
};

const requireStaffProfile = async (userId, organizationId) => {
  const profile = await StaffProfile.findOne({
    userId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();

  if (!profile) throw new AppError("staff_profile_not_found", 403);
  return profile;
};

const getBranchSettings = async (branchId) => {
  const branch = await Branch.findById(branchId).select("settings").lean();
  if (!branch) throw new AppError("branch_not_found", 404);
  return branch.settings || {};
};

const AUTO_CLOCK_OUT_AFTER_SHIFT_END_HOURS = 3;
const AUTO_CLOCK_OUT_AFTER_CLOCK_IN_HOURS = 10;
const AUTO_CLOCK_OUT_BATCH = 200;

const hoursFromSettings = (value, fallback) => {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 ? hours : fallback;
};

const closeExpiredOpenSessions = async ({ branchId, staffId } = {}) => {
  const filter = { clockOutAt: null };
  if (staffId) filter.staffId = staffId;
  if (branchId) filter.branchId = branchId;

  const days = await AttendanceDay.find(filter)
    .sort({ clockInAt: 1 })
    .limit(AUTO_CLOCK_OUT_BATCH);
  if (!days.length) return { scanned: 0, closed: 0 };

  const branchIds = [...new Set(days.map((day) => String(day.branchId)))];
  const [branches, shifts] = await Promise.all([
    Branch.find({ _id: { $in: branchIds } }).select("settings").lean(),
    Shift.find({
      _id: { $in: days.map((day) => day.shiftId).filter(Boolean) },
    })
      .select("endsAt")
      .lean(),
  ]);
  const settingsByBranch = new Map(
    branches.map((branch) => [String(branch._id), branch.settings || {}])
  );
  const shiftById = new Map(shifts.map((shift) => [String(shift._id), shift]));

  const now = Date.now();
  const ops = [];
  for (const day of days) {
    const settings = settingsByBranch.get(String(day.branchId)) || {};
    const afterShiftEnd = hoursFromSettings(
      settings.autoClockOutHoursAfterShiftEnd,
      AUTO_CLOCK_OUT_AFTER_SHIFT_END_HOURS
    );
    const afterClockIn = hoursFromSettings(
      settings.autoClockOutHoursAfterClockIn,
      AUTO_CLOCK_OUT_AFTER_CLOCK_IN_HOURS
    );

    let dueAtMs = null;
    if (day.shiftId) {
      const shift = shiftById.get(String(day.shiftId));
      if (!shift?.endsAt) continue;
      dueAtMs = new Date(shift.endsAt).getTime() + afterShiftEnd * 3600000;
    } else {
      dueAtMs = new Date(day.clockInAt).getTime() + afterClockIn * 3600000;
    }
    if (now < dueAtMs) continue;

    const clockOutAt = new Date(dueAtMs);
    const breaks = (day.breaks || []).map((segment) => ({
      breakInAt: segment.breakInAt,
      breakOutAt: segment.breakOutAt || clockOutAt,
    }));
    const next = {
      clockOutAt,
      presenceStatus: PresenceStatus.CHECKED_OUT,
      autoClosed: true,
      breaks,
    };
    next.workedMinutes = computeWorkedMinutes(
      { ...day.toObject(), ...next },
      settings
    );
    ops.push({
      updateOne: {
        filter: { _id: day._id, clockOutAt: null },
        update: { $set: next },
      },
    });
  }

  if (!ops.length) return { scanned: days.length, closed: 0 };
  const result = await AttendanceDay.bulkWrite(ops);
  return { scanned: days.length, closed: result.modifiedCount || 0 };
};

const normalizeClientEventId = (value) => {
  if (value == null) return null;
  const id = String(value).trim();
  return id || null;
};

const findByClientEventId = async (clientEventId) => {
  const id = normalizeClientEventId(clientEventId);
  if (!id) return null;
  return AttendanceDay.findOne({ clientEventId: id }).lean();
};

const toClockInPhotoUrl = (key) => toPublicImageUrl(key);

const CLOCK_IN_TZ = "Europe/London";

const greetingForHour = (hour) => {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const presentClockIn = async ({ staffId, image, day, shift }) => {
  const photoUrl = toClockInPhotoUrl(image);
  if (photoUrl) {
    await StaffProfile.updateOne({ _id: staffId }, { $set: { photoUrl } });
  }

  const profile = await StaffProfile.findById(staffId)
    .select("userId photoUrl ward locationLabel branchId")
    .lean();

  const [user, branch] = await Promise.all([
    profile?.userId
      ? User.findById(profile.userId).select("name").lean()
      : null,
    profile?.branchId
      ? Branch.findById(profile.branchId).select("name timezone").lean()
      : null,
  ]);

  const tz = branch?.timezone || CLOCK_IN_TZ;
  const clockMoment = moment.tz(day.clockInAt, tz);
  const url = photoUrl || toClockInPhotoUrl(profile?.photoUrl) || "";
  const location =
    profile?.ward || profile?.locationLabel || branch?.name || "";
  const shiftLabel = shift
    ? `${moment.tz(shift.startsAt, tz).format("HH:mm")} – ${moment
        .tz(shift.endsAt, tz)
        .format("HH:mm")}`
    : null;

  return {
    ...day,
    image: url,
    photoUrl: url,
    greeting: greetingForHour(clockMoment.hour()),
    name: user?.name || "",
    time: clockMoment.format("hh:mm a"),
    location,
    shift: shift
      ? {
          _id: shift._id,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          status: shift.status,
          branchId: shift.branchId,
          label: shiftLabel,
        }
      : null,
    summary: {
      time: clockMoment.format("hh:mm a"),
      shift: shiftLabel,
      location,
    },
  };
};

const getOpenAttendanceDay = async (staffId) => {
  return AttendanceDay.findOne({
    staffId,
    clockOutAt: null,
  })
    .sort({ clockInAt: -1 })
    .lean();
};

const assertNotAlreadyClockedIn = async (staffId) => {
  const openDay = await getOpenAttendanceDay(staffId);
  if (openDay) throw new AppError("attendance_open_session_exists", 409);
};

const latestAttendanceForWorkDate = (staffId, workDate) =>
  AttendanceDay.findOne({ staffId, workDate }).sort({ clockInAt: -1 }).lean();

const assertClientEventAvailable = (existingByEvent, staffId) => {
  if (!existingByEvent) return;
  if (String(existingByEvent.staffId) !== String(staffId)) {
    throw new AppError("attendance_client_event_used", 409);
  }
  if (existingByEvent.clockOutAt) {
    throw new AppError("attendance_client_event_used", 409);
  }
};

const requireOpenAttendanceDay = async (staffId) => {
  const openDay = await AttendanceDay.findOne({
    staffId,
    clockOutAt: null,
  }).sort({ clockInAt: -1 });

  if (openDay) return openDay;

  const last = await AttendanceDay.findOne({ staffId })
    .select("clockOutAt")
    .sort({ clockInAt: -1 })
    .lean();
  if (last?.clockOutAt) throw new AppError("attendance_already_clocked_out", 409);
  throw new AppError("attendance_not_clocked_in", 400);
};

const staffSummary = (profile, userById) => {
  if (!profile) return null;
  const user = userById.get(String(profile.userId));
  return {
    _id: profile._id,
    employeeCode: profile.employeeCode,
    name: user?.name || "",
    email: user?.email || "",
    photoUrl: profile.photoUrl || "",
  };
};

const ATTENDANCE_LIST_LOOKUPS = [
  {
    $lookup: {
      from: StaffProfile.collection.name,
      localField: "staffId",
      foreignField: "_id",
      as: "_staff",
    },
  },
  { $unwind: { path: "$_staff", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: User.collection.name,
      localField: "_staff.userId",
      foreignField: "_id",
      as: "_user",
    },
  },
  { $unwind: { path: "$_user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      as: "_branch",
    },
  },
  { $unwind: { path: "$_branch", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      staff: {
        _id: "$_staff._id",
        employeeCode: "$_staff.employeeCode",
        name: { $ifNull: ["$_user.name", ""] },
        email: { $ifNull: ["$_user.email", ""] },
        photoUrl: { $ifNull: ["$_staff.photoUrl", ""] },
      },
      branch: {
        $cond: [
          { $ifNull: ["$_branch._id", false] },
          {
            _id: "$_branch._id",
            name: "$_branch.name",
            code: "$_branch.code",
            status: "$_branch.status",
            timezone: "$_branch.timezone",
            settings: "$_branch.settings",
          },
          null,
        ],
      },
    },
  },
  { $unset: ["_staff", "_user", "_branch"] },
];

const utcDateKey = (value) => moment.utc(value).format("YYYY-MM-DD");

const formatClockedHours = (clockInAt, clockOutAt, timezone) => {
  if (!clockInAt || !clockOutAt) return null;
  const tz = timezone || DEFAULT_TZ;
  const start = moment.tz(clockInAt, tz);
  const end = moment.tz(clockOutAt, tz);
  if (!start.isValid() || !end.isValid() || end.isBefore(start)) return null;
  const totalMinutes = end.diff(start, "minutes");
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}hrs ${minutes} m`;
};

const withComputedWorkedMinutes = (days) =>
  days.map((day) => ({
    ...day,
    kind: day.kind || "attendance",
    workedMinutes:
      day.workedMinutes ??
      computeWorkedMinutes(day, day.branch?.settings || {}),
    totalHours: formatClockedHours(
      day.clockInAt,
      day.clockOutAt,
      day.branch?.timezone || DEFAULT_TZ
    ),
  }));

const fetchAttendanceDays = async ({ match, sort }) => {
  const data = await AttendanceDay.aggregate([
    { $match: match },
    { $sort: sort },
    ...ATTENDANCE_LIST_LOOKUPS,
  ]);
  return withComputedWorkedMinutes(data);
};

const mergeAttendanceAndLeave = (attendanceDays, leaveDays) => {
  const keyed = new Map();
  const attendanceDates = new Set();
  for (const day of attendanceDays) {
    keyed.set(String(day._id), { ...day, kind: "attendance" });
    attendanceDates.add(`${day.staffId}:${utcDateKey(day.workDate)}`);
  }
  for (const day of leaveDays) {
    const dateKey = `${day.staffId}:${utcDateKey(day.workDate)}`;
    if (attendanceDates.has(dateKey)) continue;
    keyed.set(`leave:${dateKey}`, { ...day, workedMinutes: 0 });
  }
  return [...keyed.values()].sort((a, b) => {
    const byDate = new Date(b.workDate) - new Date(a.workDate);
    if (byDate) return byDate;
    const byClock = new Date(b.clockInAt || 0) - new Date(a.clockInAt || 0);
    if (byClock) return byClock;
    return String(a.staff?.name || "").localeCompare(String(b.staff?.name || ""));
  });
};

const filterRegisterRows = (rows, { presenceStatus, leaveType, punctualityStatus } = {}) =>
  rows.filter((row) => {
    if (presenceStatus && row.presenceStatus !== presenceStatus) return false;
    if (leaveType && row.leaveType !== leaveType) return false;
    if (punctualityStatus && row.punctualityStatus !== punctualityStatus) return false;
    return true;
  });

const paginateRows = (rows, page, limit, skip) => ({
  data: rows.slice(skip, skip + limit),
  meta: generateMeta(page, limit, rows.length),
});

const PUNCTUALITY_STATUSES = Object.values(PunctualityStatus);

const emptyPunctualityStatusCounts = () =>
  Object.fromEntries(PUNCTUALITY_STATUSES.map((status) => [status, 0]));

/** Tab counts ignore `punctualityStatus` so each total stays independent of the list filter. */
const punctualityStatusCountFacets = (countMatch) =>
  Object.fromEntries(
    PUNCTUALITY_STATUSES.map((status) => [
      `${status}Count`,
      [{ $match: { ...countMatch, punctualityStatus: status } }, { $count: "count" }],
    ])
  );

const punctualityStatusCountsFromFacet = (result) =>
  Object.fromEntries(
    PUNCTUALITY_STATUSES.map((status) => [
      status,
      facetCount(result[`${status}Count`]),
    ])
  );

const parsePunctualityStatus = (status) => {
  if (status == null || String(status).trim() === "" || String(status).trim() === "all") {
    return undefined;
  }
  const value = String(status).trim();
  if (!PUNCTUALITY_STATUSES.includes(value)) {
    throw new AppError("invalid_punctuality_status", 400);
  }
  return value;
};

const emptySummary = {
  onTimeCount: 0,
  lateCount: 0,
  unscheduledCount: 0,
  sickDays: 0,
  absenceDays: 0,
  attendanceRate: 0,
};

const registerSummary = (rows) => {
  const summary = { ...emptySummary };
  for (const row of rows) {
    if (row.kind === "leave") {
      if (row.leaveType === LeaveType.SICK) summary.sickDays += 1;
      if (row.leaveType === LeaveType.ABSENCE) summary.absenceDays += 1;
      continue;
    }
    if (row.punctualityStatus === PunctualityStatus.ON_TIME) summary.onTimeCount += 1;
    if (row.punctualityStatus === PunctualityStatus.LATE) summary.lateCount += 1;
    if (row.punctualityStatus === PunctualityStatus.UNSCHEDULED) {
      summary.unscheduledCount += 1;
    }
  }
  const denom =
    summary.onTimeCount +
    summary.lateCount +
    summary.sickDays +
    summary.absenceDays;
  summary.attendanceRate = denom
    ? Math.round((100 * (summary.onTimeCount + summary.lateCount)) / denom)
    : 0;
  return summary;
};

const emptyRegisterPage = (page, limit) => ({
  data: [],
  meta: {
    ...generateMeta(page, limit, 0),
    counts: emptyPunctualityStatusCounts(),
  },
  summary: { ...emptySummary },
});

const summaryFromCounts = (counts, leaveDays = []) => {
  const summary = registerSummary(leaveDays);
  summary.onTimeCount = counts.onTime;
  summary.lateCount = counts.late;
  summary.unscheduledCount = counts.unscheduled || 0;
  const denom =
    summary.onTimeCount +
    summary.lateCount +
    summary.sickDays +
    summary.absenceDays;
  summary.attendanceRate = denom
    ? Math.round((100 * (summary.onTimeCount + summary.lateCount)) / denom)
    : 0;
  return summary;
};

/** Staff in scope whose user name or email matches `keyword`. */
const staffIdsMatchingKeyword = async (staffIds, keyword) => {
  const term = String(keyword || "").trim();
  if (!term || !staffIds?.length) return staffIds || [];

  const regex = { $regex: escapeRegex(term), $options: "i" };
  const rows = await StaffProfile.aggregate([
    { $match: { _id: { $in: staffIds } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        pipeline: [
          { $match: { $or: [{ name: regex }, { email: regex }] } },
          { $project: { _id: 1 } },
        ],
        as: "user",
      },
    },
    { $match: { user: { $ne: [] } } },
    { $project: { _id: 1 } },
  ]);

  return rows.map((row) => row._id);
};

const listStaffSummaries = async (staffIds) => {
  if (!staffIds?.length) return [];
  return StaffProfile.aggregate([
    {
      $match: {
        _id: { $in: staffIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        status: StaffProfileStatus.ACTIVE,
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        as: "_user",
      },
    },
    { $unwind: { path: "$_user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        employeeCode: 1,
        photoUrl: { $ifNull: ["$photoUrl", ""] },
        name: { $ifNull: ["$_user.name", ""] },
        email: { $ifNull: ["$_user.email", ""] },
      },
    },
    { $sort: { name: 1 } },
  ]);
};

const attachAttendanceDetails = async (days) => {
  if (!days?.length) return days;

  const staffIds = [...new Set(days.map((d) => String(d.staffId)))];
  const branchIds = [...new Set(days.map((d) => String(d.branchId)))];

  const [staffProfiles, branches] = await Promise.all([
    StaffProfile.find({ _id: { $in: staffIds } })
      .select("_id userId employeeCode photoUrl")
      .lean(),
    Branch.find({ _id: { $in: branchIds } })
      .select("_id name code status settings")
      .lean(),
  ]);

  const userIds = staffProfiles.map((p) => p.userId);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("name email")
        .lean()
    : [];

  const staffById = new Map(staffProfiles.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const branchById = new Map(branches.map((b) => [String(b._id), b]));

  return days.map((day) => ({
    ...day,
    staff: staffSummary(staffById.get(String(day.staffId)), userById),
    branch: branchById.get(String(day.branchId)) || null,
    workedMinutes:
      day.workedMinutes ??
      computeWorkedMinutes(
        day,
        branchById.get(String(day.branchId))?.settings || {}
      ),
  }));
};

const assertPhoneCheckInAllowed = async (branchId) => {
  const settings = await getBranchSettings(branchId);
  if (!settings.allowPhoneCheckIn) {
    throw new AppError("phone_check_in_not_allowed", 403);
  }
};

const resolvePunctuality = (clockInAt, shiftStartsAt, graceMinutes) => {
  const graceMs = (graceMinutes ?? 5) * 60 * 1000;
  const lateAfter = new Date(shiftStartsAt).getTime() + graceMs;
  return new Date(clockInAt).getTime() > lateAfter
    ? PunctualityStatus.LATE
    : PunctualityStatus.ON_TIME;
};

const clockInFromActiveShift = (active, clockInAt) => {
  const hasRosteredShift = Boolean(active.clockInEligible && active.shift);
  return {
    hasRosteredShift,
    punctualityStatus: hasRosteredShift
      ? resolvePunctuality(
          clockInAt,
          active.shift.startsAt,
          active.graceMinutes
        )
      : PunctualityStatus.UNSCHEDULED,
    shiftId: hasRosteredShift ? active.shift._id : null,
  };
};

const staffCannotClockIn = async (staffId) => {
  await closeExpiredOpenSessions({ staffId });
  return Boolean(await getOpenAttendanceDay(staffId));
};

const getTodayAttendance = async ({ userId, organizationId }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const workDate = startOfUtcDay(new Date());
  const [day, activeShift] = await Promise.all([
    latestAttendanceForWorkDate(profile._id, workDate),
    getActiveShift({ userId, organizationId }),
  ]);

  const enriched = day ? (await attachAttendanceDetails([day]))[0] : null;

  return {
    attendance: enriched,
    activeShift,
  };
};

const clockIn = async ({
  userId,
  organizationId,
  checkInMethod = CheckInMethod.PHONE,
  clientEventId,
  geo,
  occurredAt,
  image,
}) => {
  const eventId = normalizeClientEventId(clientEventId);
  const profile = await requireStaffProfile(userId, organizationId);
  await closeExpiredOpenSessions({
    staffId: profile._id,
    branchId: profile.branchId,
  });
  const existingByEvent = await findByClientEventId(eventId);
  if (existingByEvent && !existingByEvent.clockOutAt) {
    if (String(existingByEvent.staffId) !== String(profile._id)) {
      throw new AppError("attendance_client_event_used", 409);
    }
    const activeShift = await getActiveShiftForStaff({
      staffProfile: profile,
      organizationId,
    });
    return presentClockIn({
      staffId: existingByEvent.staffId,
      image,
      day: existingByEvent,
      shift: activeShift.shift,
    });
  }
  assertClientEventAvailable(existingByEvent, profile._id);

  if (checkInMethod === CheckInMethod.PHONE) {
    await assertPhoneCheckInAllowed(profile.branchId);
  }

  const active = await getActiveShift({ userId, organizationId });
  // Previously required an assigned shift in the clock-in window.
  // if (!active.clockInEligible || !active.shift) {
  //   throw new AppError("no_active_shift_for_clock_in", 403);
  // }

  const clockInAt = occurredAt ? new Date(occurredAt) : new Date();
  const workDate = startOfUtcDay(clockInAt);
  await assertNotAlreadyClockedIn(profile._id);

  const rostered = clockInFromActiveShift(active, clockInAt);

  const day = await AttendanceDay.create({
    staffId: profile._id,
    branchId: profile.branchId,
    workDate,
    shiftId: rostered.shiftId,
    clockInAt,
    checkInMethod,
    punctualityStatus: rostered.punctualityStatus,
    presenceStatus: PresenceStatus.ON_SITE,
    clientEventId: eventId,
    occurredAt: occurredAt ? new Date(occurredAt) : null,
    geo: geo || undefined,
  });

  return presentClockIn({
    staffId: profile._id,
    image,
    day: day.toObject(),
    shift: rostered.hasRosteredShift ? active.shift : null,
  });
};

const clockOut = async ({
  userId,
  organizationId,
  clientEventId,
  occurredAt,
}) => {
  const eventId = normalizeClientEventId(clientEventId);
  const profile = await requireStaffProfile(userId, organizationId);
  const day = await requireOpenAttendanceDay(profile._id);

  if (day.presenceStatus === PresenceStatus.ON_BREAK) {
    throw new AppError("attendance_on_break", 400);
  }

  const clockOutAt = occurredAt ? new Date(occurredAt) : new Date();
  day.clockOutAt = clockOutAt;
  day.presenceStatus = PresenceStatus.CHECKED_OUT;
  const settings = await getBranchSettings(day.branchId);
  day.workedMinutes = computeWorkedMinutes(day, settings);
  if (eventId && !day.clientEventId) day.clientEventId = eventId;
  await day.save();

  return day.toObject();
};

const assertStaffAtBranch = (profile, branchId) => {
  if (String(profile.branchId) !== String(branchId)) {
    throw new AppError("staff_not_at_kiosk_branch", 403);
  }
};

const clockInForStaff = async ({
  staffProfile,
  organizationId,
  branchId,
  checkInMethod = CheckInMethod.KIOSK,
  clientEventId,
  occurredAt,
  image,
}) => {
  assertStaffAtBranch(staffProfile, branchId);
  await closeExpiredOpenSessions({
    staffId: staffProfile._id,
    branchId,
  });

  const eventId = normalizeClientEventId(clientEventId);
  const clockInAt = occurredAt ? new Date(occurredAt) : new Date();
  const workDate = startOfUtcDay(clockInAt);
  await assertNotAlreadyClockedIn(staffProfile._id);

  const existingByEvent = await findByClientEventId(eventId);
  assertClientEventAvailable(existingByEvent, staffProfile._id);

  const active = await getActiveShiftForStaff({
    staffProfile,
    organizationId,
  });
  // Previously required an assigned shift in the clock-in window.
  // if (!active.clockInEligible || !active.shift) {
  //   throw new AppError("no_active_shift_for_clock_in", 403);
  // }

  const rostered = clockInFromActiveShift(active, clockInAt);

  const day = await AttendanceDay.create({
    staffId: staffProfile._id,
    branchId: staffProfile.branchId,
    workDate,
    shiftId: rostered.shiftId,
    clockInAt,
    checkInMethod,
    punctualityStatus: rostered.punctualityStatus,
    presenceStatus: PresenceStatus.ON_SITE,
    clientEventId: eventId,
    occurredAt: occurredAt ? new Date(occurredAt) : null,
  });

  return presentClockIn({
    staffId: staffProfile._id,
    image,
    day: day.toObject(),
    shift: rostered.hasRosteredShift ? active.shift : null,
  });
};

const clockOutForStaff = async ({
  staffProfile,
  branchId,
  clientEventId,
  occurredAt,
}) => {
  assertStaffAtBranch(staffProfile, branchId);

  const eventId = normalizeClientEventId(clientEventId);
  const day = await requireOpenAttendanceDay(staffProfile._id);

  if (day.presenceStatus === PresenceStatus.ON_BREAK) {
    throw new AppError("attendance_on_break", 400);
  }

  const clockOutAt = occurredAt ? new Date(occurredAt) : new Date();
  day.clockOutAt = clockOutAt;
  day.presenceStatus = PresenceStatus.CHECKED_OUT;
  const settings = await getBranchSettings(day.branchId);
  day.workedMinutes = computeWorkedMinutes(day, settings);
  if (eventId && !day.clientEventId) day.clientEventId = eventId;
  await day.save();

  return day.toObject();
};

const listOnSiteForBranch = async ({ branchId, keyword, page, limit, skip }) => {
  await closeExpiredOpenSessions({ branchId });
  const term = String(keyword ?? "").trim();
  const keywordMatch = term
    ? {
        $or: [
          { "staff.employeeCode": { $regex: escapeRegex(term), $options: "i" } },
          { "user.name": { $regex: escapeRegex(term), $options: "i" } },
        ],
      }
    : null;

  const [result] = await AttendanceDay.aggregate([
    {
      $match: {
        branchId: new mongoose.Types.ObjectId(String(branchId)),
        presenceStatus: { $in: ON_SITE_PRESENCE },
        clockOutAt: null,
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
    { $unwind: "$staff" },
    {
      $lookup: {
        from: User.collection.name,
        localField: "staff.userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $facet: {
        data: [
          ...(keywordMatch ? [{ $match: keywordMatch }] : []),
          { $sort: { "user.name": 1, clockInAt: 1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              staffId: "$staff._id",
              employeeCode: "$staff.employeeCode",
              name: { $ifNull: ["$user.name", ""] },
              photoUrl: { $ifNull: ["$staff.photoUrl", ""] },
              clockInAt: 1,
              presenceStatus: 1,
            },
          },
        ],
        totalCount: [
          ...(keywordMatch ? [{ $match: keywordMatch }] : []),
          { $count: "count" },
        ],
        onSiteCount: [{ $count: "count" }],
      },
    },
  ]);

  const totalRecords = facetCount(result.totalCount);
  return {
    data: result.data,
    meta: {
      ...generateMeta(page, limit, totalRecords),
      onSiteCount: facetCount(result.onSiteCount),
    },
  };
};

const breakTakenMinutes = (day, now) => {
  let ms = 0;
  for (const segment of day.breaks || []) {
    if (!segment.breakInAt) continue;
    const end = segment.breakOutAt ? new Date(segment.breakOutAt) : now;
    ms += end - new Date(segment.breakInAt);
  }
  return Math.max(0, Math.round(ms / 60000));
};

const getOpenClockInSessionForStaff = async ({ staffProfile }) => {
  await closeExpiredOpenSessions({ staffId: staffProfile._id });
  const day = await getOpenAttendanceDay(staffProfile._id);
  if (!day) return null;

  const now = new Date();
  return {
    attendanceId: day._id,
    clockInAt: day.clockInAt,
    presenceStatus: day.presenceStatus,
    breakTakenMinutes: breakTakenMinutes(day, now),
    totalOnSiteMinutes: Math.max(
      0,
      Math.round((now - new Date(day.clockInAt)) / 60000)
    ),
  };
};

const getTodayAttendanceForStaff = async ({
  staffProfile,
  organizationId,
  branchId,
}) => {
  assertStaffAtBranch(staffProfile, branchId);
  const workDate = startOfUtcDay(new Date());
  const [day, activeShift] = await Promise.all([
    latestAttendanceForWorkDate(staffProfile._id, workDate),
    getActiveShiftForStaff({ staffProfile, organizationId }),
  ]);

  const enriched = day ? (await attachAttendanceDetails([day]))[0] : null;
  return { attendance: enriched, activeShift };
};

const startBreak = async ({ userId, organizationId, occurredAt }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const settings = await getBranchSettings(profile.branchId);
  if (!settings.enableBreaks) throw new AppError("breaks_not_enabled", 400);

  const day = await AttendanceDay.findOne({
    staffId: profile._id,
    clockOutAt: null,
  }).sort({ clockInAt: -1 });

  if (!day) throw new AppError("attendance_not_clocked_in", 400);
  if (day.presenceStatus === PresenceStatus.ON_BREAK) {
    throw new AppError("attendance_already_on_break", 409);
  }

  const breakInAt = occurredAt ? new Date(occurredAt) : new Date();
  day.breaks.push({ breakInAt, breakOutAt: null });
  day.presenceStatus = PresenceStatus.ON_BREAK;
  await day.save();

  return day.toObject();
};

const endBreak = async ({ userId, organizationId, occurredAt }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const day = await AttendanceDay.findOne({
    staffId: profile._id,
    clockOutAt: null,
    presenceStatus: PresenceStatus.ON_BREAK,
  }).sort({ clockInAt: -1 });

  if (!day) throw new AppError("attendance_not_on_break", 400);

  const openBreak = [...day.breaks].reverse().find((b) => !b.breakOutAt);
  if (!openBreak) throw new AppError("attendance_not_on_break", 400);

  openBreak.breakOutAt = occurredAt ? new Date(occurredAt) : new Date();
  day.presenceStatus = PresenceStatus.ON_SITE;
  await day.save();

  return day.toObject();
};

const listMyAttendance = async ({
  userId,
  organizationId,
  page,
  limit,
  skip,
  from,
  to,
  punctualityStatus,
}) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const match = { staffId: profile._id };

  if (from || to) {
    match.workDate = {};
    if (from) match.workDate.$gte = startOfUtcDay(from);
    if (to) match.workDate.$lte = startOfUtcDay(to);
  }

  const punctuality = parsePunctualityStatus(punctualityStatus);
  const listMatch = punctuality
    ? { ...match, punctualityStatus: punctuality }
    : match;

  const { data, meta, result } = await paginateWithFacet({
    model: AttendanceDay,
    match: listMatch,
    page,
    limit,
    skip,
    sort: { createdAt: -1, clockInAt: -1 },
    extraDataStages: ATTENDANCE_LIST_LOOKUPS,
    extraFacets: punctualityStatusCountFacets(match),
  });

  const counts = result
    ? punctualityStatusCountsFromFacet(result)
    : emptyPunctualityStatusCounts();

  return {
    data: withComputedWorkedMinutes(data),
    meta: { ...meta, counts },
    summary: summaryFromCounts(counts, []),
  };
};

const createChangeRequest = async ({
  userId,
  organizationId,
  attendanceDayId,
  payload,
}) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const day = await AttendanceDay.findOne({
    _id: attendanceDayId,
    staffId: profile._id,
  }).lean();

  if (!day) throw new AppError("attendance_day_not_found", 404);

  const pending = await AttendanceChangeRequest.findOne({
    attendanceDayId,
    status: ChangeRequestStatus.PENDING,
  }).lean();

  if (pending) throw new AppError("attendance_change_request_pending", 409);

  const request = await AttendanceChangeRequest.create({
    attendanceDayId,
    requestedBy: userId,
    payload,
  });

  return request.toObject();
};

const listAttendanceDays = async ({
  organizationId,
  page,
  limit,
  skip,
  branchId,
  staffId,
  from,
  to,
  presenceStatus,
  leaveType,
  punctualityStatus,
  keyword,
  actor,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);

  const branchMatch = { organizationId };
  if (scopedBranchId) branchMatch._id = scopedBranchId;

  const branchIds = await Branch.find(branchMatch).distinct("_id");
  if (!branchIds.length) return emptyRegisterPage(page, limit);

  const match = { branchId: { $in: branchIds } };
  const inScope = await applyLineManagerStaffScope({
    match,
    standing,
    actor,
    organizationId,
    staffId,
  });
  if (!inScope) return emptyRegisterPage(page, limit);

  if (from || to) {
    match.workDate = {};
    if (from) match.workDate.$gte = startOfUtcDay(from);
    if (to) match.workDate.$lte = startOfUtcDay(to);
  }

  if (presenceStatus) match.presenceStatus = presenceStatus;

  const scopedStaffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });
  const staffIds = await staffIdsMatchingKeyword(scopedStaffIds, keyword);
  if (!staffIds.length) return emptyRegisterPage(page, limit);
  if (String(keyword || "").trim()) match.staffId = { $in: staffIds };

  const punctuality = parsePunctualityStatus(punctualityStatus);

  if (leaveType && !punctuality) {
    const leaveDays = await listLeaveRegisterDays({ staffIds, from, to });
    const rows = filterRegisterRows(leaveDays, { leaveType });
    return {
      ...paginateRows(rows, page, limit, skip),
      meta: {
        ...generateMeta(page, limit, rows.length),
        counts: emptyPunctualityStatusCounts(),
      },
      summary: registerSummary(leaveDays),
    };
  }

  const countMatch = { ...match };
  if (punctuality) match.punctualityStatus = punctuality;

  const [{ data, meta, result }, leaveDays] = await Promise.all([
    paginateWithFacet({
      model: AttendanceDay,
      match,
      page,
      limit,
      skip,
      sort: { workDate: -1, clockInAt: -1 },
      extraDataStages: ATTENDANCE_LIST_LOOKUPS,
      extraFacets: punctualityStatusCountFacets(countMatch),
    }),
    punctuality ? Promise.resolve([]) : listLeaveRegisterDays({ staffIds, from, to }),
  ]);

  const counts = punctualityStatusCountsFromFacet(result);
  return {
    data: withComputedWorkedMinutes(data),
    meta: { ...meta, counts },
    summary: summaryFromCounts(counts, leaveDays),
  };
};

const resolveDayRange = (from, to, timezone, { defaultFrom, defaultTo }) => {
  const tz = timezone || DEFAULT_TZ;
  const fromDay = from
    ? moment.tz(String(from).slice(0, 10), "YYYY-MM-DD", tz).startOf("day")
    : defaultFrom(tz);
  const toDay = to
    ? moment.tz(String(to).slice(0, 10), "YYYY-MM-DD", tz).startOf("day")
    : from
      ? fromDay.clone()
      : defaultTo(tz);

  if (!fromDay.isValid() || !toDay.isValid() || toDay.isBefore(fromDay)) {
    throw new AppError("invalid_date_range", 400);
  }
  if (toDay.diff(fromDay, "days") > MAX_ROTA_RANGE_DAYS) {
    throw new AppError("attendance_rota_range_too_large", 400);
  }

  return { tz, fromDay, toDay };
};

const resolveRotaRange = (from, to, timezone) =>
  resolveDayRange(from, to, timezone, {
    defaultFrom: (tz) => moment.tz(tz).startOf("isoWeek"),
    defaultTo: (tz) => moment.tz(tz).endOf("isoWeek").startOf("day"),
  });

/** Reports default to the current calendar month when from/to are omitted. */
const resolveReportRange = (from, to, timezone) =>
  resolveDayRange(from, to, timezone, {
    defaultFrom: (tz) => moment.tz(tz).startOf("month"),
    defaultTo: (tz) => moment.tz(tz).endOf("month").startOf("day"),
  });

const buildRotaWeeks = (fromDay, toDay) => {
  const weeks = [];
  const cursor = fromDay.clone().startOf("isoWeek");
  const lastWeek = toDay.clone().startOf("isoWeek");
  while (!cursor.isAfter(lastWeek)) {
    const dates = [];
    for (let i = 0; i < 7; i += 1) {
      dates.push(cursor.clone().add(i, "days").format("YYYY-MM-DD"));
    }
    weeks.push({
      weekStart: dates[0],
      weekEnd: dates[6],
      dates,
      staff: [],
    });
    cursor.add(1, "week");
  }
  return weeks;
};

const rotaCellFromRow = (row) => {
  if (!row) return { kind: "empty" };
  if (row.kind === "leave") {
    return {
      kind: "leave",
      leaveType: row.leaveType,
      presenceStatus: row.presenceStatus,
      leaveRequestId: row.leaveRequestId,
      source: row.source,
    };
  }
  return {
    kind: "attendance",
    clockInAt: row.clockInAt,
    clockOutAt: row.clockOutAt,
    punctualityStatus: row.punctualityStatus,
    presenceStatus: row.presenceStatus,
    workedMinutes: row.workedMinutes,
    breaks: row.breaks || [],
  };
};

const staffRotaTotals = (byDate) => {
  const totals = {
    workedMinutes: 0,
    onTimeCount: 0,
    lateCount: 0,
    unscheduledCount: 0,
    sickDays: 0,
    absenceDays: 0,
  };
  for (const cell of byDate.values()) {
    const rows = Array.isArray(cell) ? cell : [cell];
    for (const row of rows) {
      if (row.kind === "leave") {
        if (row.leaveType === LeaveType.SICK) totals.sickDays += 1;
        if (row.leaveType === LeaveType.ABSENCE) totals.absenceDays += 1;
        continue;
      }
      totals.workedMinutes += row.workedMinutes || 0;
      if (row.punctualityStatus === PunctualityStatus.ON_TIME) {
        totals.onTimeCount += 1;
      }
      if (row.punctualityStatus === PunctualityStatus.LATE) totals.lateCount += 1;
      if (row.punctualityStatus === PunctualityStatus.UNSCHEDULED) {
        totals.unscheduledCount += 1;
      }
    }
  }
  return totals;
};

const rotaCellFromRows = (rows) => {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  if (!list.length) return { kind: "empty" };
  const attendance = list
    .filter((row) => row.kind !== "leave")
    .sort((a, b) => new Date(a.clockInAt) - new Date(b.clockInAt));
  if (!attendance.length) return rotaCellFromRow(list[0]);
  const latest = attendance[attendance.length - 1];
  const cell = rotaCellFromRow(latest);
  cell.workedMinutes = attendance.reduce(
    (sum, row) => sum + (row.workedMinutes || 0),
    0
  );
  if (attendance.length > 1) {
    cell.sessions = attendance.map(rotaCellFromRow);
  }
  return cell;
};

const listAttendanceRota = async ({
  organizationId,
  branchId,
  staffId,
  from,
  to,
  timezone,
  keyword,
  actor,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);

  const branchMatch = { organizationId };
  if (scopedBranchId) branchMatch._id = scopedBranchId;
  const branches = await Branch.find(branchMatch).select("_id timezone").lean();
  if (!branches.length) {
    const { tz, fromDay, toDay } = resolveRotaRange(from, to, timezone);
    return {
      timezone: tz,
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      weeks: [],
      summary: { ...emptySummary },
    };
  }

  const tz =
    timezone ||
    (scopedBranchId
      ? branches[0].timezone
      : branches.length === 1
        ? branches[0].timezone
        : DEFAULT_TZ) ||
    DEFAULT_TZ;
  const { fromDay, toDay } = resolveRotaRange(from, to, tz);

  const scopedStaffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });
  const staffIds = await staffIdsMatchingKeyword(scopedStaffIds, keyword);
  if (!staffIds.length) {
    return {
      timezone: tz,
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      weeks: buildRotaWeeks(fromDay, toDay),
      summary: { ...emptySummary },
    };
  }

  const fromUtc = startOfUtcDay(fromDay.format("YYYY-MM-DD"));
  const toUtc = startOfUtcDay(toDay.format("YYYY-MM-DD"));
  const match = {
    branchId: { $in: branches.map((b) => b._id) },
    staffId: { $in: staffIds },
    workDate: { $gte: fromUtc, $lte: toUtc },
  };

  const [staffList, attendanceDays, leaveDays] = await Promise.all([
    listStaffSummaries(staffIds),
    fetchAttendanceDays({
      match,
      sort: { workDate: 1, clockInAt: 1 },
    }),
    listLeaveRegisterDays({ staffIds, from: fromUtc, to: toUtc }),
  ]);

  const rows = mergeAttendanceAndLeave(attendanceDays, leaveDays);
  const byStaffDate = new Map();
  for (const row of rows) {
    const sid = String(row.staffId);
    if (!byStaffDate.has(sid)) byStaffDate.set(sid, new Map());
    const dateKey = utcDateKey(row.workDate);
    const current = byStaffDate.get(sid).get(dateKey);
    if (!current) byStaffDate.get(sid).set(dateKey, [row]);
    else current.push(row);
  }

  const summary = { ...emptySummary };
  const staffRows = staffList.map((staff) => {
    const byDate = byStaffDate.get(String(staff._id)) || new Map();
    const totals = staffRotaTotals(byDate);
    summary.onTimeCount += totals.onTimeCount;
    summary.lateCount += totals.lateCount;
    summary.unscheduledCount += totals.unscheduledCount;
    summary.sickDays += totals.sickDays;
    summary.absenceDays += totals.absenceDays;
    return { staff, totals, byDate };
  });

  const denom =
    summary.onTimeCount +
    summary.lateCount +
    summary.sickDays +
    summary.absenceDays;
  summary.attendanceRate = denom
    ? Math.round((100 * (summary.onTimeCount + summary.lateCount)) / denom)
    : 0;

  const weeks = buildRotaWeeks(fromDay, toDay).map((week) => ({
    ...week,
    staff: staffRows.map(({ staff, totals, byDate }) => {
      const days = {};
      for (const date of week.dates) {
        days[date] = rotaCellFromRows(byDate.get(date));
      }
      return { staff, totals, days };
    }),
  }));

  return {
    timezone: tz,
    from: fromDay.format("YYYY-MM-DD"),
    to: toDay.format("YYYY-MM-DD"),
    weeks,
    summary,
  };
};

const getAttendanceDay = async ({ attendanceDayId, organizationId, actor }) => {
  const day = await AttendanceDay.findById(attendanceDayId).lean();
  if (!day) throw new AppError("attendance_day_not_found", 404);

  const branch = await Branch.findById(day.branchId).select("organizationId").lean();
  if (!branch || String(branch.organizationId) !== String(organizationId)) {
    throw new AppError("attendance_day_not_found", 404);
  }

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    assertMayManageStaff(standing, day.branchId);
  }

  const [enriched] = await attachAttendanceDetails([day]);
  return enriched;
};

const updateAttendanceDay = async ({
  actor,
  organizationId,
  attendanceDayId,
  clockInAt,
  clockOutAt,
  breaks,
}) => {
  const day = await AttendanceDay.findById(attendanceDayId);
  if (!day) throw new AppError("attendance_day_not_found", 404);

  const branch = await Branch.findById(day.branchId).select("organizationId").lean();
  if (!branch || String(branch.organizationId) !== String(organizationId)) {
    throw new AppError("attendance_day_not_found", 404);
  }

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, day.branchId);

  if (clockInAt !== undefined) day.clockInAt = new Date(clockInAt);
  if (clockOutAt !== undefined) day.clockOutAt = clockOutAt ? new Date(clockOutAt) : null;
  if (breaks !== undefined) day.breaks = breaks;

  if (clockInAt !== undefined || clockOutAt !== undefined || breaks !== undefined) {
    day.checkInMethod = CheckInMethod.MANUAL;
    const settings = await getBranchSettings(day.branchId);
    day.workedMinutes = computeWorkedMinutes(day, settings);
    if (day.clockOutAt) {
      day.presenceStatus = PresenceStatus.CHECKED_OUT;
    } else if (day.breaks?.some((b) => !b.breakOutAt)) {
      day.presenceStatus = PresenceStatus.ON_BREAK;
    } else {
      day.presenceStatus = PresenceStatus.ON_SITE;
    }
  }

  if (!day.isModified()) throw new AppError("nothing_to_update", 400);
  await day.save();

  const [enriched] = await attachAttendanceDetails([day.toObject()]);
  return enriched;
};

const listChangeRequests = async ({
  organizationId,
  page,
  limit,
  skip,
  status,
  actor,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, null);

  const branchMatch = { organizationId };
  if (scopedBranchId) branchMatch._id = scopedBranchId;
  const branchIds = await Branch.find(branchMatch).distinct("_id");

  const dayMatch = { branchId: { $in: branchIds } };
  const inScope = await applyLineManagerStaffScope({
    match: dayMatch,
    standing,
    actor,
    organizationId,
  });
  if (!inScope) {
    return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }

  const dayIds = await AttendanceDay.find(dayMatch).distinct("_id");

  const match = { attendanceDayId: { $in: dayIds } };
  if (status) match.status = status;

  const { data, meta } = await paginateWithFacet({
    model: AttendanceChangeRequest,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
  });

  return { data, meta };
};

const approveChangeRequest = async ({
  actor,
  organizationId,
  requestId,
  managerStaffId = null,
}) => {
  const request = await AttendanceChangeRequest.findById(requestId);
  if (!request || request.status !== ChangeRequestStatus.PENDING) {
    throw new AppError("attendance_change_request_not_found", 404);
  }

  const day = await AttendanceDay.findById(request.attendanceDayId);
  if (!day) throw new AppError("attendance_day_not_found", 404);

  const branch = await Branch.findById(day.branchId).select("organizationId").lean();
  if (!branch || String(branch.organizationId) !== String(organizationId)) {
    throw new AppError("attendance_change_request_not_found", 404);
  }

  const standing = await actorStanding(actor, organizationId);
  await assertMayApproveForStaff({
    standing,
    actor,
    organizationId,
    branchId: day.branchId,
    targetStaffId: day.staffId,
    managerStaffId,
  });

  const payload = request.payload || {};
  for (const key of CORRECTABLE_FIELDS) {
    if (payload[key] !== undefined) day[key] = payload[key];
  }
  day.checkInMethod = CheckInMethod.MANUAL;
  const settings = await getBranchSettings(day.branchId);
  day.workedMinutes = computeWorkedMinutes(day, settings);
  if (day.clockOutAt) day.presenceStatus = PresenceStatus.CHECKED_OUT;

  request.status = ChangeRequestStatus.APPROVED;
  request.reviewedBy = actor._id;

  await Promise.all([day.save(), request.save()]);

  return { request: request.toObject(), attendanceDay: day.toObject() };
};

const rejectChangeRequest = async ({
  actor,
  organizationId,
  requestId,
  managerStaffId = null,
}) => {
  const request = await AttendanceChangeRequest.findById(requestId);
  if (!request || request.status !== ChangeRequestStatus.PENDING) {
    throw new AppError("attendance_change_request_not_found", 404);
  }

  const day = await AttendanceDay.findById(request.attendanceDayId).lean();
  if (!day) throw new AppError("attendance_day_not_found", 404);

  const branch = await Branch.findById(day.branchId).select("organizationId").lean();
  if (!branch || String(branch.organizationId) !== String(organizationId)) {
    throw new AppError("attendance_change_request_not_found", 404);
  }

  const standing = await actorStanding(actor, organizationId);
  await assertMayApproveForStaff({
    standing,
    actor,
    organizationId,
    branchId: day.branchId,
    targetStaffId: day.staffId,
    managerStaffId,
  });

  request.status = ChangeRequestStatus.REJECTED;
  request.reviewedBy = actor._id;
  await request.save();

  return request.toObject();
};

const loadAttendanceDayInOrg = async (attendanceDayId, organizationId) => {
  const day = await AttendanceDay.findById(attendanceDayId);
  if (!day) throw new AppError("attendance_day_not_found", 404);

  const branch = await Branch.findById(day.branchId)
    .select("organizationId")
    .lean();
  if (!branch || String(branch.organizationId) !== String(organizationId)) {
    throw new AppError("attendance_day_not_found", 404);
  }
  return day;
};

const requestRosterForDay = async ({
  userId,
  organizationId,
  attendanceDayId,
}) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const day = await loadAttendanceDayInOrg(attendanceDayId, organizationId);

  if (String(day.staffId) !== String(profile._id)) {
    throw new AppError("attendance_day_not_found", 404);
  }
  if (day.punctualityStatus !== PunctualityStatus.UNSCHEDULED) {
    throw new AppError("attendance_not_unscheduled", 400);
  }
  if (!day.clockOutAt) throw new AppError("attendance_not_clocked_out", 400);
  if (day.shiftId) throw new AppError("attendance_already_rostered", 409);
  if (day.rosterRequestStatus === RosterRequestStatus.PENDING) {
    throw new AppError("attendance_roster_request_pending", 409);
  }
  if (day.rosterRequestStatus === RosterRequestStatus.APPROVED) {
    throw new AppError("attendance_already_rostered", 409);
  }

  day.rosterRequestStatus = RosterRequestStatus.PENDING;
  day.rosterRequestedAt = new Date();
  await day.save();
  return day.toObject();
};

const approveRosterForDay = async ({
  actor,
  organizationId,
  attendanceDayId,
  startsAt,
  endsAt,
}) => {
  const day = await loadAttendanceDayInOrg(attendanceDayId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, day.branchId);

  if (day.rosterRequestStatus === RosterRequestStatus.APPROVED && day.shiftId) {
    const shift = await getShift({
      shiftId: day.shiftId,
      organizationId,
    });
    return { day: day.toObject(), shift };
  }

  if (day.punctualityStatus !== PunctualityStatus.UNSCHEDULED) {
    throw new AppError("attendance_not_unscheduled", 400);
  }
  if (day.shiftId) throw new AppError("attendance_already_rostered", 409);
  if (!day.clockOutAt && !endsAt) {
    throw new AppError("attendance_not_clocked_out", 400);
  }

  const shift = await createScheduledShiftFromAttendance({
    organizationId,
    branchId: day.branchId,
    staffId: day.staffId,
    startsAt: startsAt || day.clockInAt,
    endsAt: endsAt || day.clockOutAt,
  });

  day.shiftId = shift._id;
  day.rosterRequestStatus = RosterRequestStatus.APPROVED;
  day.rosterReviewedBy = actor._id;
  day.rosterReviewedAt = new Date();
  await day.save();

  return { day: day.toObject(), shift };
};

const rejectRosterForDay = async ({
  actor,
  organizationId,
  attendanceDayId,
}) => {
  const day = await loadAttendanceDayInOrg(attendanceDayId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, day.branchId);

  if (day.rosterRequestStatus === RosterRequestStatus.APPROVED || day.shiftId) {
    throw new AppError("attendance_already_rostered", 409);
  }
  if (day.punctualityStatus !== PunctualityStatus.UNSCHEDULED) {
    throw new AppError("attendance_not_unscheduled", 400);
  }

  day.rosterRequestStatus = RosterRequestStatus.REJECTED;
  day.rosterReviewedBy = actor._id;
  day.rosterReviewedAt = new Date();
  await day.save();
  return day.toObject();
};

const FILLED_SHIFT_STATUSES = [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED];

const emptyWeekBuckets = () =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    scheduled: 0,
    worked: 0,
  }));

const REPORT_STAFF_LOOKUPS = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "userId",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1, email: 1 } }, { $limit: 1 }],
      as: "_user",
    },
  },
  {
    $lookup: {
      from: Department.collection.name,
      localField: "departmentIds",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
      as: "_dept",
    },
  },
  {
    $addFields: {
      name: { $ifNull: [{ $arrayElemAt: ["$_user.name", 0] }, ""] },
      email: { $ifNull: [{ $arrayElemAt: ["$_user.email", 0] }, ""] },
      department: { $arrayElemAt: ["$_dept", 0] },
    },
  },
  {
    $project: {
      employeeCode: 1,
      photoUrl: 1,
      name: 1,
      email: 1,
      department: 1,
    },
  },
];

const shapeReportStaff = (row) => ({
  _id: row._id,
  employeeCode: row.employeeCode || "",
  name: row.name || "",
  email: row.email || "",
  photoUrl: toPublicImageUrl(row.photoUrl) || row.photoUrl || "",
  department: row.department
    ? { _id: row.department._id, name: row.department.name }
    : null,
});

const bumpWeek = (weekly, weekday, field) => {
  if (weekday < 1 || weekday > 7) return;
  weekly[weekday - 1][field] += 1;
};

const attendanceReport = async ({
  actor,
  organizationId,
  branchId,
  departmentId,
  from,
  to,
  page,
  limit,
  skip,
}) => {
  const fromDate = from && String(from).trim() ? from : undefined;
  const toDate = to && String(to).trim() ? to : undefined;

  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  const branchMatch = { organizationId };
  if (scopedBranchId) branchMatch._id = scopedBranchId;
  const branches = await Branch.find(branchMatch).select("_id timezone").lean();
  if (!branches.length) {
    const { tz, fromDay, toDay } = resolveReportRange(fromDate, toDate, DEFAULT_TZ);
    return {
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      timezone: tz,
      branchId: scopedBranchId || null,
      kpis: {
        workedMinutes: 0,
        lateCount: 0,
        sickDays: 0,
        sicknessRate: null,
      },
      weekly: emptyWeekBuckets(),
      rows: [],
      meta: generateMeta(page, limit, 0),
    };
  }

  const tz =
    (scopedBranchId
      ? branches[0].timezone
      : branches.length === 1
        ? branches[0].timezone
        : DEFAULT_TZ) || DEFAULT_TZ;
  const { fromDay, toDay } = resolveReportRange(fromDate, toDate, tz);
  const fromUtc = startOfUtcDay(fromDay.format("YYYY-MM-DD"));
  const toUtc = startOfUtcDay(toDay.format("YYYY-MM-DD"));
  const shiftEnd = moment.utc(toUtc).add(1, "day").toDate();
  const branchOids = branches.map((row) => row._id);

  let staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    branchId,
  });
  if (departmentId) {
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      throw new AppError("invalid_department_id", 400);
    }
    staffIds = await StaffProfile.find({
      _id: { $in: staffIds },
      departmentIds: new mongoose.Types.ObjectId(String(departmentId)),
    }).distinct("_id");
  }
  if (!staffIds.length) {
    return {
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      timezone: tz,
      branchId: scopedBranchId || null,
      kpis: {
        workedMinutes: 0,
        lateCount: 0,
        sickDays: 0,
        sicknessRate: null,
      },
      weekly: emptyWeekBuckets(),
      rows: [],
      meta: generateMeta(page, limit, 0),
    };
  }

  const staffOids = staffIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const dayMatch = {
    branchId: { $in: branchOids },
    staffId: { $in: staffOids },
    workDate: { $gte: fromUtc, $lte: toUtc },
  };

  const [attendanceGroups, shiftGroups, leaveDays, paged] = await Promise.all([
    AttendanceDay.aggregate([
      { $match: dayMatch },
      {
        $group: {
          _id: { staffId: "$staffId", workDate: "$workDate" },
          workedMinutes: { $sum: { $ifNull: ["$workedMinutes", 0] } },
          lateCount: {
            $sum: {
              $cond: [
                { $eq: ["$punctualityStatus", PunctualityStatus.LATE] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: "$_id.staffId",
          workedDays: { $sum: 1 },
          workedMinutes: { $sum: "$workedMinutes" },
          lateCount: { $sum: "$lateCount" },
          days: { $push: "$_id.workDate" },
        },
      },
    ]),
    Shift.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(String(organizationId)),
          branchId: { $in: branchOids },
          staffId: { $in: staffOids },
          status: { $in: FILLED_SHIFT_STATUSES },
          startsAt: { $gte: fromUtc, $lt: shiftEnd },
        },
      },
      {
        $group: {
          _id: {
            staffId: "$staffId",
            day: {
              $dateToString: { format: "%Y-%m-%d", date: "$startsAt", timezone: tz },
            },
          },
        },
      },
      {
        $group: {
          _id: "$_id.staffId",
          scheduledDays: { $sum: 1 },
          days: { $push: "$_id.day" },
        },
      },
    ]),
    listLeaveRegisterDays({ staffIds: staffOids, from: fromUtc, to: toUtc }),
    paginateWithFacet({
      model: StaffProfile,
      match: { _id: { $in: staffOids } },
      page,
      limit,
      skip,
      sort: { createdAt: -1 },
      extraDataStages: REPORT_STAFF_LOOKUPS,
    }),
  ]);

  const byStaff = new Map();
  const weekly = emptyWeekBuckets();
  let workedMinutes = 0;
  let lateCount = 0;
  let workedDaysTotal = 0;

  for (const row of attendanceGroups) {
    const key = String(row._id);
    const current = byStaff.get(key) || {
      scheduled: 0,
      worked: 0,
      lateCount: 0,
      workedMinutes: 0,
      sickDays: 0,
    };
    current.worked = row.workedDays;
    current.lateCount = row.lateCount;
    current.workedMinutes = row.workedMinutes;
    byStaff.set(key, current);
    workedMinutes += row.workedMinutes;
    lateCount += row.lateCount;
    workedDaysTotal += row.workedDays;
    for (const day of row.days || []) {
      bumpWeek(weekly, moment.utc(day).isoWeekday(), "worked");
    }
  }

  for (const row of shiftGroups) {
    const key = String(row._id);
    const current = byStaff.get(key) || {
      scheduled: 0,
      worked: 0,
      lateCount: 0,
      workedMinutes: 0,
      sickDays: 0,
    };
    current.scheduled = row.scheduledDays;
    byStaff.set(key, current);
    for (const day of row.days || []) {
      bumpWeek(weekly, moment.utc(day, "YYYY-MM-DD").isoWeekday(), "scheduled");
    }
  }

  let sickDays = 0;
  for (const row of leaveDays) {
    if (row.leaveType !== LeaveType.SICK) continue;
    const key = String(row.staffId);
    const current = byStaff.get(key) || {
      scheduled: 0,
      worked: 0,
      lateCount: 0,
      workedMinutes: 0,
      sickDays: 0,
    };
    current.sickDays += 1;
    byStaff.set(key, current);
    sickDays += 1;
  }

  const denom = workedDaysTotal + sickDays;
  const rows = paged.data.map((staff) => {
    const stats = byStaff.get(String(staff._id)) || {
      scheduled: 0,
      worked: 0,
      lateCount: 0,
      workedMinutes: 0,
      sickDays: 0,
    };
    return {
      staff: shapeReportStaff(staff),
      scheduled: stats.scheduled,
      worked: stats.worked,
      variance: stats.worked - stats.scheduled,
      lateCount: stats.lateCount,
      workedMinutes: stats.workedMinutes,
    };
  });

  return {
    from: fromDay.format("YYYY-MM-DD"),
    to: toDay.format("YYYY-MM-DD"),
    timezone: tz,
    branchId: scopedBranchId || null,
    kpis: {
      workedMinutes,
      lateCount,
      sickDays,
      sicknessRate: denom ? Math.round((1000 * sickDays) / denom) / 10 : null,
    },
    weekly,
    rows,
    meta: paged.meta,
  };
};

const emptyCheckInMethodCounts = () =>
  Object.fromEntries(Object.values(CheckInMethod).map((method) => [method, 0]));

const emptyStaffHoursSummary = ({ from, to, timezone, branchId }) => ({
  from,
  to,
  timezone,
  branchId: branchId || null,
  kpis: {
    workedMinutes: 0,
    visitorSignIns: 0,
    lateCount: 0,
    sicknessRate: null,
  },
  hoursByPersonType: {
    staff: 0,
    visitor: 0,
    contractor: 0,
  },
  checkInMethod: emptyCheckInMethodCounts(),
});

const staffHoursSummary = async ({
  actor,
  organizationId,
  branchId,
  departmentId,
  from,
  to,
}) => {
  const fromDate = from && String(from).trim() ? from : undefined;
  const toDate = to && String(to).trim() ? to : undefined;

  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  const branchMatch = { organizationId };
  if (scopedBranchId) branchMatch._id = scopedBranchId;
  const branches = await Branch.find(branchMatch).select("_id timezone").lean();
  const tzFallback = DEFAULT_TZ;

  if (!branches.length) {
    const { tz, fromDay, toDay } = resolveReportRange(
      fromDate,
      toDate,
      tzFallback
    );
    return emptyStaffHoursSummary({
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      timezone: tz,
      branchId: scopedBranchId || null,
    });
  }

  const tz =
    (scopedBranchId
      ? branches[0].timezone
      : branches.length === 1
        ? branches[0].timezone
        : DEFAULT_TZ) || DEFAULT_TZ;
  const { fromDay, toDay } = resolveReportRange(fromDate, toDate, tz);
  const fromUtc = startOfUtcDay(fromDay.format("YYYY-MM-DD"));
  const toUtc = startOfUtcDay(toDay.format("YYYY-MM-DD"));
  const sessionFrom = fromDay.toDate();
  const sessionTo = toDay.clone().endOf("day").toDate();
  const branchOids = branches.map((row) => row._id);

  let staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    branchId,
  });
  let departmentOid = null;
  if (departmentId) {
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      throw new AppError("invalid_department_id", 400);
    }
    departmentOid = new mongoose.Types.ObjectId(String(departmentId));
    staffIds = await StaffProfile.find({
      _id: { $in: staffIds },
      departmentIds: departmentOid,
    }).distinct("_id");
  }

  const staffOids = staffIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const dayMatch =
    staffOids.length > 0
      ? {
          branchId: { $in: branchOids },
          staffId: { $in: staffOids },
          workDate: { $gte: fromUtc, $lte: toUtc },
        }
      : null;

  const visitMatch = {
    branchId: { $in: branchOids },
    checkInAt: { $gte: sessionFrom, $lte: sessionTo },
  };

  const visitPersonStages = departmentOid
    ? [
        {
          $lookup: {
            from: ExternalPerson.collection.name,
            localField: "externalPersonId",
            foreignField: "_id",
            pipeline: [
              { $project: { departmentId: 1 } },
              { $limit: 1 },
            ],
            as: "_person",
          },
        },
        {
          $addFields: {
            person: { $arrayElemAt: ["$_person", 0] },
          },
        },
        { $match: { "person.departmentId": departmentOid } },
      ]
    : [];

  const [attendanceFacet, leaveDays, visitFacet] = await Promise.all([
    dayMatch
      ? AttendanceDay.aggregate([
          { $match: dayMatch },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    workedMinutes: {
                      $sum: { $ifNull: ["$workedMinutes", 0] },
                    },
                    lateCount: {
                      $sum: {
                        $cond: [
                          {
                            $eq: [
                              "$punctualityStatus",
                              PunctualityStatus.LATE,
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    },
                    workedDays: { $sum: 1 },
                  },
                },
              ],
              methods: [
                { $group: { _id: "$checkInMethod", count: { $sum: 1 } } },
              ],
            },
          },
        ])
      : Promise.resolve([
          { totals: [], methods: [] },
        ]),
    staffOids.length
      ? listLeaveRegisterDays({
          staffIds: staffOids,
          from: fromUtc,
          to: toUtc,
        })
      : Promise.resolve([]),
    VisitSession.aggregate([
      { $match: visitMatch },
      ...visitPersonStages,
      {
        $facet: {
          signIns: [{ $count: "count" }],
          hours: [
            { $match: { checkOutAt: { $ne: null } } },
            {
              $group: {
                _id: "$personType",
                minutes: {
                  $sum: {
                    $divide: [
                      { $subtract: ["$checkOutAt", "$checkInAt"] },
                      60000,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]),
  ]);

  const totals = attendanceFacet[0]?.totals?.[0] || {};
  const workedMinutes = totals.workedMinutes || 0;
  const lateCount = totals.lateCount || 0;
  const workedDaysTotal = totals.workedDays || 0;
  const checkInMethod = emptyCheckInMethodCounts();
  for (const row of attendanceFacet[0]?.methods || []) {
    if (Object.prototype.hasOwnProperty.call(checkInMethod, row._id)) {
      checkInMethod[row._id] = row.count;
    }
  }

  let sickDays = 0;
  for (const row of leaveDays) {
    if (row.leaveType === LeaveType.SICK) sickDays += 1;
  }
  const denom = workedDaysTotal + sickDays;

  const visitRow = visitFacet[0] || {};
  const visitorSignIns = visitRow.signIns?.[0]?.count || 0;
  const hoursByPersonType = { staff: workedMinutes, visitor: 0, contractor: 0 };
  for (const row of visitRow.hours || []) {
    const minutes = Math.round(row.minutes || 0);
    if (row._id === ExternalPersonType.VISITOR) {
      hoursByPersonType.visitor = minutes;
    }
    if (row._id === ExternalPersonType.CONTRACTOR) {
      hoursByPersonType.contractor = minutes;
    }
  }

  return {
    from: fromDay.format("YYYY-MM-DD"),
    to: toDay.format("YYYY-MM-DD"),
    timezone: tz,
    branchId: scopedBranchId || null,
    kpis: {
      workedMinutes,
      visitorSignIns,
      lateCount,
      sicknessRate: denom
        ? Math.round((1000 * sickDays) / denom) / 10
        : null,
    },
    hoursByPersonType,
    checkInMethod,
  };
};

const PRESENCE_STATUSES = Object.values(PresenceStatus);

const emptyPresenceStatusCounts = () =>
  Object.fromEntries(PRESENCE_STATUSES.map((status) => [status, 0]));

const parsePresenceStatus = (status) => {
  if (status == null || String(status).trim() === "" || String(status).trim() === "all") {
    return undefined;
  }
  const value = String(status).trim();
  if (!PRESENCE_STATUSES.includes(value)) {
    throw new AppError("invalid_presence_status", 400);
  }
  return value;
};

const presenceStatusCountsFromFacet = (result) => {
  const counts = emptyPresenceStatusCounts();
  for (const row of result.presenceCounts || []) {
    if (Object.prototype.hasOwnProperty.call(counts, row._id)) {
      counts[row._id] = row.count;
    }
  }
  return counts;
};

const shapeLateCheckInRow = (row) => {
  const staff = row.staff || null;
  return {
    ...row,
    kind: "attendance",
    type: "staff",
    staff: staff
      ? { ...staff, photoUrl: toPublicImageUrl(staff.photoUrl) }
      : null,
  };
};

const lateCheckInsReport = async ({
  actor,
  organizationId,
  branchId,
  departmentId,
  from,
  to,
  keyword,
  presenceStatus,
  page,
  limit,
  skip,
}) => {
  const fromDate = from && String(from).trim() ? from : undefined;
  const toDate = to && String(to).trim() ? to : undefined;
  const presence = parsePresenceStatus(presenceStatus);

  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  const branchMatch = { organizationId };
  if (scopedBranchId) branchMatch._id = scopedBranchId;
  const branches = await Branch.find(branchMatch).select("_id timezone").lean();

  const empty = (fromLabel, toLabel, timezone) => ({
    from: fromLabel,
    to: toLabel,
    timezone,
    branchId: scopedBranchId || null,
    kpis: { onSite: 0, staff: 0, late: 0 },
    rows: [],
    meta: {
      ...generateMeta(page, limit, 0),
      counts: emptyPresenceStatusCounts(),
    },
  });

  if (!branches.length) {
    const { tz, fromDay, toDay } = resolveReportRange(
      fromDate,
      toDate,
      DEFAULT_TZ
    );
    return empty(
      fromDay.format("YYYY-MM-DD"),
      toDay.format("YYYY-MM-DD"),
      tz
    );
  }

  const tz =
    (scopedBranchId
      ? branches[0].timezone
      : branches.length === 1
        ? branches[0].timezone
        : DEFAULT_TZ) || DEFAULT_TZ;
  const { fromDay, toDay } = resolveReportRange(fromDate, toDate, tz);
  const fromUtc = startOfUtcDay(fromDay.format("YYYY-MM-DD"));
  const toUtc = startOfUtcDay(toDay.format("YYYY-MM-DD"));
  const branchOids = branches.map((row) => row._id);

  let staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    branchId,
  });
  if (departmentId) {
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      throw new AppError("invalid_department_id", 400);
    }
    staffIds = await StaffProfile.find({
      _id: { $in: staffIds },
      departmentIds: new mongoose.Types.ObjectId(String(departmentId)),
    }).distinct("_id");
  }
  staffIds = await staffIdsMatchingKeyword(staffIds, keyword);
  if (!staffIds.length) {
    return empty(
      fromDay.format("YYYY-MM-DD"),
      toDay.format("YYYY-MM-DD"),
      tz
    );
  }

  const staffOids = staffIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rangeMatch = {
    branchId: { $in: branchOids },
    staffId: { $in: staffOids },
    workDate: { $gte: fromUtc, $lte: toUtc },
  };
  const lateMatch = {
    ...rangeMatch,
    punctualityStatus: PunctualityStatus.LATE,
  };
  const listMatch = presence
    ? { ...lateMatch, presenceStatus: presence }
    : lateMatch;

  const liveOnSiteMatch = {
    branchId: { $in: branchOids },
    staffId: { $in: staffOids },
    presenceStatus: { $in: ON_SITE_PRESENCE },
    clockOutAt: null,
  };

  const [{ data, meta, result }, staffCount, onSiteCount] = await Promise.all([
    paginateWithFacet({
      model: AttendanceDay,
      match: listMatch,
      page,
      limit,
      skip,
      sort: { clockInAt: -1 },
      extraDataStages: ATTENDANCE_LIST_LOOKUPS,
      extraFacets: {
        presenceCounts: [
          { $match: lateMatch },
          { $group: { _id: "$presenceStatus", count: { $sum: 1 } } },
        ],
        lateCount: [{ $match: lateMatch }, { $count: "count" }],
      },
    }),
    AttendanceDay.countDocuments(rangeMatch),
    AttendanceDay.countDocuments(liveOnSiteMatch),
  ]);

  return {
    from: fromDay.format("YYYY-MM-DD"),
    to: toDay.format("YYYY-MM-DD"),
    timezone: tz,
    branchId: scopedBranchId || null,
    kpis: {
      onSite: onSiteCount,
      staff: staffCount,
      late: facetCount(result?.lateCount),
    },
    rows: withComputedWorkedMinutes(data).map(shapeLateCheckInRow),
    meta: {
      ...meta,
      counts: presenceStatusCountsFromFacet(result || {}),
    },
  };
};

module.exports = {
  getTodayAttendance,
  getTodayAttendanceForStaff,
  getOpenClockInSessionForStaff,
  listOnSiteForBranch,
  clockIn,
  clockInForStaff,
  clockOut,
  clockOutForStaff,
  startBreak,
  endBreak,
  listMyAttendance,
  createChangeRequest,
  listAttendanceDays,
  listAttendanceRota,
  getAttendanceDay,
  updateAttendanceDay,
  listChangeRequests,
  approveChangeRequest,
  rejectChangeRequest,
  staffCannotClockIn,
  closeExpiredOpenSessions,
  requestRosterForDay,
  approveRosterForDay,
  rejectRosterForDay,
  attendanceReport,
  staffHoursSummary,
  lateCheckInsReport,
};
