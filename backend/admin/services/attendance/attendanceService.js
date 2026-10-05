const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { AttendanceDay } = require("@models/AttendanceDay");
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
} = require("@models/domainEnums");
const { getActiveShift, getActiveShiftForStaff } = require("@adminServices/rota/shiftService");
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

const findByClientEventId = async (clientEventId) => {
  if (!clientEventId) return null;
  return AttendanceDay.findOne({ clientEventId }).lean();
};

const getOpenAttendanceDay = async (staffId) => {
  return AttendanceDay.findOne({
    staffId,
    clockOutAt: null,
  })
    .sort({ clockInAt: -1 })
    .lean();
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

const withComputedWorkedMinutes = (days) =>
  days.map((day) => ({
    ...day,
    kind: day.kind || "attendance",
    workedMinutes:
      day.workedMinutes ??
      computeWorkedMinutes(day, day.branch?.settings || {}),
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
  for (const day of attendanceDays) {
    keyed.set(`${day.staffId}:${utcDateKey(day.workDate)}`, {
      ...day,
      kind: "attendance",
    });
  }
  for (const day of leaveDays) {
    const key = `${day.staffId}:${utcDateKey(day.workDate)}`;
    if (keyed.has(key)) continue;
    keyed.set(key, { ...day, workedMinutes: 0 });
  }
  return [...keyed.values()].sort((a, b) => {
    const byDate = new Date(b.workDate) - new Date(a.workDate);
    if (byDate) return byDate;
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

const emptySummary = {
  onTimeCount: 0,
  lateCount: 0,
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
  meta: generateMeta(page, limit, 0),
  summary: { ...emptySummary },
});

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

const getTodayAttendance = async ({ userId, organizationId }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const workDate = startOfUtcDay(new Date());
  const [day, activeShift] = await Promise.all([
    AttendanceDay.findOne({ staffId: profile._id, workDate }).lean(),
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
}) => {
  const existingByEvent = await findByClientEventId(clientEventId);
  if (existingByEvent) return existingByEvent;

  const profile = await requireStaffProfile(userId, organizationId);

  if (checkInMethod === CheckInMethod.PHONE) {
    await assertPhoneCheckInAllowed(profile.branchId);
  }

  const active = await getActiveShift({ userId, organizationId });
  if (!active.clockInEligible || !active.shift) {
    throw new AppError("no_active_shift_for_clock_in", 403);
  }

  const clockInAt = occurredAt ? new Date(occurredAt) : new Date();
  const workDate = startOfUtcDay(clockInAt);

  const alreadyToday = await AttendanceDay.findOne({
    staffId: profile._id,
    workDate,
  }).lean();

  if (alreadyToday) throw new AppError("attendance_already_clocked_in", 409);

  const openDay = await getOpenAttendanceDay(profile._id);
  if (openDay) throw new AppError("attendance_open_session_exists", 409);

  const punctualityStatus = resolvePunctuality(
    clockInAt,
    active.shift.startsAt,
    active.graceMinutes
  );

  const day = await AttendanceDay.create({
    staffId: profile._id,
    branchId: profile.branchId,
    workDate,
    clockInAt,
    checkInMethod,
    punctualityStatus,
    presenceStatus: PresenceStatus.ON_SITE,
    clientEventId: clientEventId || null,
    occurredAt: occurredAt ? new Date(occurredAt) : null,
    geo: geo || undefined,
  });

  return day.toObject();
};

const clockOut = async ({
  userId,
  organizationId,
  clientEventId,
  occurredAt,
}) => {
  const existingByEvent = await findByClientEventId(clientEventId);
  if (existingByEvent) return existingByEvent;

  const profile = await requireStaffProfile(userId, organizationId);
  const day = await AttendanceDay.findOne({
    staffId: profile._id,
    clockOutAt: null,
  }).sort({ clockInAt: -1 });

  if (!day) throw new AppError("attendance_not_clocked_in", 400);
  if (day.presenceStatus === PresenceStatus.ON_BREAK) {
    throw new AppError("attendance_on_break", 400);
  }

  const clockOutAt = occurredAt ? new Date(occurredAt) : new Date();
  day.clockOutAt = clockOutAt;
  day.presenceStatus = PresenceStatus.CHECKED_OUT;
  const settings = await getBranchSettings(day.branchId);
  day.workedMinutes = computeWorkedMinutes(day, settings);
  if (clientEventId && !day.clientEventId) day.clientEventId = clientEventId;
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
}) => {
  const existingByEvent = await findByClientEventId(clientEventId);
  if (existingByEvent) return existingByEvent;

  assertStaffAtBranch(staffProfile, branchId);

  const active = await getActiveShiftForStaff({
    staffProfile,
    organizationId,
  });
  if (!active.clockInEligible || !active.shift) {
    throw new AppError("no_active_shift_for_clock_in", 403);
  }

  const clockInAt = occurredAt ? new Date(occurredAt) : new Date();
  const workDate = startOfUtcDay(clockInAt);

  const alreadyToday = await AttendanceDay.findOne({
    staffId: staffProfile._id,
    workDate,
  }).lean();

  if (alreadyToday) throw new AppError("attendance_already_clocked_in", 409);

  const openDay = await getOpenAttendanceDay(staffProfile._id);
  if (openDay) throw new AppError("attendance_open_session_exists", 409);

  const punctualityStatus = resolvePunctuality(
    clockInAt,
    active.shift.startsAt,
    active.graceMinutes
  );

  const day = await AttendanceDay.create({
    staffId: staffProfile._id,
    branchId: staffProfile.branchId,
    workDate,
    clockInAt,
    checkInMethod,
    punctualityStatus,
    presenceStatus: PresenceStatus.ON_SITE,
    clientEventId: clientEventId || null,
    occurredAt: occurredAt ? new Date(occurredAt) : null,
  });

  return day.toObject();
};

const clockOutForStaff = async ({
  staffProfile,
  branchId,
  clientEventId,
  occurredAt,
}) => {
  const existingByEvent = await findByClientEventId(clientEventId);
  if (existingByEvent) return existingByEvent;

  assertStaffAtBranch(staffProfile, branchId);

  const day = await AttendanceDay.findOne({
    staffId: staffProfile._id,
    clockOutAt: null,
  }).sort({ clockInAt: -1 });

  if (!day) throw new AppError("attendance_not_clocked_in", 400);
  if (day.presenceStatus === PresenceStatus.ON_BREAK) {
    throw new AppError("attendance_on_break", 400);
  }

  const clockOutAt = occurredAt ? new Date(occurredAt) : new Date();
  day.clockOutAt = clockOutAt;
  day.presenceStatus = PresenceStatus.CHECKED_OUT;
  const settings = await getBranchSettings(day.branchId);
  day.workedMinutes = computeWorkedMinutes(day, settings);
  if (clientEventId && !day.clientEventId) day.clientEventId = clientEventId;
  await day.save();

  return day.toObject();
};

const listOnSiteForBranch = async ({ branchId, keyword, page, limit, skip }) => {
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

const getTodayAttendanceForStaff = async ({
  staffProfile,
  organizationId,
  branchId,
}) => {
  assertStaffAtBranch(staffProfile, branchId);
  const workDate = startOfUtcDay(new Date());
  const [day, activeShift] = await Promise.all([
    AttendanceDay.findOne({ staffId: staffProfile._id, workDate }).lean(),
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
}) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const match = { staffId: profile._id };

  if (from || to) {
    match.workDate = {};
    if (from) match.workDate.$gte = startOfUtcDay(from);
    if (to) match.workDate.$lte = startOfUtcDay(to);
  }

  const attendanceDays = await fetchAttendanceDays({
    match,
    sort: { workDate: -1 },
  });
  const leaveDays = await listLeaveRegisterDays({
    staffIds: [profile._id],
    from,
    to,
  });
  const rows = mergeAttendanceAndLeave(attendanceDays, leaveDays);
  return paginateRows(rows, page, limit, skip);
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

  const staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });

  const [attendanceDays, leaveDays] = await Promise.all([
    fetchAttendanceDays({
      match,
      sort: { workDate: -1, clockInAt: -1 },
    }),
    listLeaveRegisterDays({ staffIds, from, to }),
  ]);

  const merged = mergeAttendanceAndLeave(attendanceDays, leaveDays);
  const rows = filterRegisterRows(merged, {
    presenceStatus,
    leaveType,
    punctualityStatus,
  });
  return { ...paginateRows(rows, page, limit, skip), summary: registerSummary(merged) };
};

const resolveRotaRange = (from, to, timezone) => {
  const tz = timezone || DEFAULT_TZ;
  const fromDay = from
    ? moment.tz(String(from).slice(0, 10), "YYYY-MM-DD", tz).startOf("day")
    : moment.tz(tz).startOf("isoWeek");
  const toDay = to
    ? moment.tz(String(to).slice(0, 10), "YYYY-MM-DD", tz).startOf("day")
    : from
      ? fromDay.clone()
      : moment.tz(tz).endOf("isoWeek").startOf("day");

  if (!fromDay.isValid() || !toDay.isValid() || toDay.isBefore(fromDay)) {
    throw new AppError("invalid_date_range", 400);
  }
  if (toDay.diff(fromDay, "days") > MAX_ROTA_RANGE_DAYS) {
    throw new AppError("attendance_rota_range_too_large", 400);
  }

  return { tz, fromDay, toDay };
};

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
    sickDays: 0,
    absenceDays: 0,
  };
  for (const row of byDate.values()) {
    if (row.kind === "leave") {
      if (row.leaveType === LeaveType.SICK) totals.sickDays += 1;
      if (row.leaveType === LeaveType.ABSENCE) totals.absenceDays += 1;
      continue;
    }
    totals.workedMinutes += row.workedMinutes || 0;
    if (row.punctualityStatus === PunctualityStatus.ON_TIME) totals.onTimeCount += 1;
    if (row.punctualityStatus === PunctualityStatus.LATE) totals.lateCount += 1;
  }
  return totals;
};

const listAttendanceRota = async ({
  organizationId,
  branchId,
  staffId,
  from,
  to,
  timezone,
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
      summary: { onTimeCount: 0, lateCount: 0, sickDays: 0, absenceDays: 0, attendanceRate: 0 },
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

  const staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });
  if (!staffIds.length) {
    return {
      timezone: tz,
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      weeks: buildRotaWeeks(fromDay, toDay),
      summary: { onTimeCount: 0, lateCount: 0, sickDays: 0, absenceDays: 0, attendanceRate: 0 },
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
    byStaffDate.get(sid).set(utcDateKey(row.workDate), row);
  }

  const summary = {
    onTimeCount: 0,
    lateCount: 0,
    sickDays: 0,
    absenceDays: 0,
    attendanceRate: 0,
  };
  const staffRows = staffList.map((staff) => {
    const byDate = byStaffDate.get(String(staff._id)) || new Map();
    const totals = staffRotaTotals(byDate);
    summary.onTimeCount += totals.onTimeCount;
    summary.lateCount += totals.lateCount;
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
        days[date] = rotaCellFromRow(byDate.get(date));
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

module.exports = {
  getTodayAttendance,
  getTodayAttendanceForStaff,
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
};
