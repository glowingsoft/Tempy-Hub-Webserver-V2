const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { notifyStaff, dayOf } = require("../staff/staffNotify");
const { LeaveRequest } = require("@models/LeaveRequest");
const { LeaveEntitlement } = require("@models/LeaveEntitlement");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { User } = require("@models/UserModel");
const { paginateWithFacet, facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  LeaveType,
  LeaveRequestStatus,
  LeaveRequestSource,
  StaffProfileStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertMayApproveForStaff,
  resolveScopedStaffIds,
} = require("./leaveAccess");

const assertKnownLeaveType = (leaveType) => {
  if (leaveType && !Object.values(LeaveType).includes(leaveType)) {
    throw new AppError("invalid_leave_type", 400);
  }
};

const FULL_TIME_WEEKLY_HOURS = 37.5;
const DEFAULT_FULL_YEAR_HOLIDAY_DAYS = 28;
const DEFAULT_TZ = "Europe/London";

const usesHolidayBalance = (leaveType) => leaveType === LeaveType.ANNUAL;

const STAFF_REQUESTABLE_TYPES = [LeaveType.ANNUAL];
const MANAGER_RECORDABLE_TYPES = [LeaveType.SICK, LeaveType.ABSENCE];

/** Dates that already occupy the calendar (holiday or recorded sick/absence). */
const OVERLAPPING_LEAVE_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.CLOSED,
];

const parseLeaveDates = (startDate, endDate, { allowPast = false } = {}) => {
  const start = moment.tz(startDate, DEFAULT_TZ).startOf("day");
  const end = moment.tz(endDate, DEFAULT_TZ).startOf("day");
  if (!start.isValid() || !end.isValid()) {
    throw new AppError("invalid_leave_dates", 400);
  }
  if (end.isBefore(start)) throw new AppError("leave_end_before_start", 400);
  if (!allowPast && start.isBefore(moment.tz(DEFAULT_TZ).startOf("day"))) {
    throw new AppError("leave_start_in_past", 400);
  }
  return { startDate: start.toDate(), endDate: end.toDate() };
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

const getStaffProfileOrThrow = async (staffId, organizationId) => {
  const profile = await StaffProfile.findOne({
    _id: staffId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();

  if (!profile) throw new AppError("staff_profile_not_found", 404);
  return profile;
};

const entitlementYearFromDate = (date) => {
  const m = date ? moment.tz(date, DEFAULT_TZ) : moment.tz(DEFAULT_TZ);
  const startYear = m.month() >= 3 ? m.year() : m.year() - 1;
  return `${startYear}-${startYear + 1}`;
};

const leaveYearBounds = (yearLabel) => {
  const startYear = Number(String(yearLabel).split("-")[0]);
  return {
    start: moment.tz({ year: startYear, month: 3, day: 1 }, DEFAULT_TZ).startOf("day").toDate(),
    end: moment
      .tz({ year: startYear + 1, month: 2, day: 31 }, DEFAULT_TZ)
      .endOf("day")
      .toDate(),
  };
};

/**
 * Holiday pot for a leave year: full-year days × hours factor × time in year.
 * Mid-year start uses startDate; hours use contractedWeeklyHours vs 37.5.
 */
const calculateHolidayEntitlement = ({
  startDate,
  contractedWeeklyHours = FULL_TIME_WEEKLY_HOURS,
  year,
  fullYearDays = DEFAULT_FULL_YEAR_HOLIDAY_DAYS,
}) => {
  const yearLabel = year || entitlementYearFromDate(startDate);
  const { start: yearStart, end: yearEnd } = leaveYearBounds(yearLabel);
  const yearStartM = moment.tz(yearStart, DEFAULT_TZ).startOf("day");
  const yearEndM = moment.tz(yearEnd, DEFAULT_TZ).startOf("day");
  const yearDays = yearEndM.diff(yearStartM, "days") + 1;

  const employedFrom = startDate
    ? moment.max(moment.tz(startDate, DEFAULT_TZ).startOf("day"), yearStartM)
    : yearStartM;
  const employedDays = Math.max(0, yearEndM.diff(employedFrom, "days") + 1);
  const timeFactor = yearDays ? employedDays / yearDays : 1;
  const hoursFactor = Math.min(
    1,
    Number(contractedWeeklyHours || 0) / FULL_TIME_WEEKLY_HOURS
  );

  const entitlementDays = Math.round(
    Number(fullYearDays) * hoursFactor * timeFactor * 100
  ) / 100;

  return {
    year: yearLabel,
    fullYearDays: Number(fullYearDays),
    contractedWeeklyHours: Number(contractedWeeklyHours) || 0,
    entitlementDays,
  };
};

const remainingDays = (entitlement) => {
  if (!entitlement) return 0;
  return (
    entitlement.entitlementDays +
    entitlement.carriedOverDays -
    entitlement.takenDays -
    entitlement.pendingDays
  );
};

const SCORE_LEAVE_TYPES = [LeaveType.SICK, LeaveType.ABSENCE];

const parseScoreRange = (from, to) => {
  if (!from && !to) return leaveYearBounds(entitlementYearFromDate());

  const start = moment.tz(from || to, DEFAULT_TZ).startOf("day");
  const end = moment.tz(to || from, DEFAULT_TZ).endOf("day");
  if (!start.isValid() || !end.isValid()) {
    throw new AppError("invalid_leave_dates", 400);
  }
  if (end.isBefore(start)) throw new AppError("leave_end_before_start", 400);
  return { from: start.toDate(), to: end.toDate() };
};

const scoreMatch = (staffIds, from, to) => ({
  staffId: { $in: staffIds },
  source: LeaveRequestSource.MANAGER_RECORDED,
  status: LeaveRequestStatus.CLOSED,
  leaveType: { $in: SCORE_LEAVE_TYPES },
  startDate: { $lte: to },
  endDate: { $gte: from },
});

const scoreGroup = {
  _id: "$staffId",
  sickDays: {
    $sum: { $cond: [{ $eq: ["$leaveType", LeaveType.SICK] }, "$totalDays", 0] },
  },
  sickSpells: {
    $sum: { $cond: [{ $eq: ["$leaveType", LeaveType.SICK] }, 1, 0] },
  },
  absenceDays: {
    $sum: {
      $cond: [{ $eq: ["$leaveType", LeaveType.ABSENCE] }, "$totalDays", 0],
    },
  },
  absenceSpells: {
    $sum: { $cond: [{ $eq: ["$leaveType", LeaveType.ABSENCE] }, 1, 0] },
  },
};

const emptyScore = (staffId) => ({
  staffId,
  sickDays: 0,
  sickSpells: 0,
  absenceDays: 0,
  absenceSpells: 0,
  sicknessScore: 0,
  absenceScore: 0,
});

const shapeScore = (row) => {
  const sickDays = row?.sickDays || 0;
  const absenceDays = row?.absenceDays || 0;
  return {
    staffId: row?._id,
    sickDays,
    sickSpells: row?.sickSpells || 0,
    absenceDays,
    absenceSpells: row?.absenceSpells || 0,
    sicknessScore: sickDays,
    absenceScore: absenceDays,
  };
};

const attachScoreStaff = async (rows) => {
  if (!rows.length) return rows;
  const staffIds = rows.map((row) => row.staffId).filter(Boolean);
  const profiles = await StaffProfile.find({ _id: { $in: staffIds } })
    .select("_id userId employeeCode")
    .lean();
  const users = await User.find({
    _id: { $in: profiles.map((profile) => profile.userId) },
  })
    .select("name email")
    .lean();
  const profileById = new Map(profiles.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((row) => ({
    ...row,
    staff: staffSummary(profileById.get(String(row.staffId)), userById),
  }));
};

const getOrCreateEntitlement = async ({
  staffId,
  organizationId,
  year,
  leaveType,
}) => {
  let entitlement = await LeaveEntitlement.findOne({
    staffId,
    year,
    leaveType,
  });

  if (!entitlement) {
    entitlement = await LeaveEntitlement.create({
      staffId,
      organizationId: organizationId || undefined,
      year,
      leaveType,
      entitlementDays: 0,
    });
  }

  return entitlement;
};

const assertSufficientBalance = async ({
  staffId,
  organizationId,
  year,
  leaveType,
  totalDays,
  excludeRequestId,
}) => {
  if (!usesHolidayBalance(leaveType)) return;

  const entitlement = await getOrCreateEntitlement({
    staffId,
    organizationId,
    year,
    leaveType,
  });

  let available = remainingDays(entitlement);

  if (excludeRequestId) {
    const existing = await LeaveRequest.findById(excludeRequestId).lean();
    if (
      existing &&
      existing.status === LeaveRequestStatus.APPROVED &&
      String(existing.leaveType) === String(leaveType)
    ) {
      available += existing.totalDays;
    }
  }

  if (totalDays > available) {
    throw new AppError("insufficient_leave_balance", 400);
  }
};

const assertNoOverlap = async (staffId, startDate, endDate, excludeRequestId) => {
  const match = {
    staffId,
    status: { $in: OVERLAPPING_LEAVE_STATUSES },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  };

  if (excludeRequestId) {
    match._id = { $ne: excludeRequestId };
  }

  const overlap = await LeaveRequest.exists(match);
  if (overlap) throw new AppError("leave_dates_overlap", 409);
};

const staffSummary = (profile, userById) => {
  if (!profile) return null;
  const user = userById.get(String(profile.userId));
  return {
    _id: profile._id,
    employeeCode: profile.employeeCode,
    name: user?.name || "",
    email: user?.email || "",
  };
};

const userLookup = (localField, as) => ({
  $lookup: {
    from: User.collection.name,
    localField,
    foreignField: "_id",
    pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
    as,
  },
});

const attachLeaveRequestDetails = async (requests, { withOrganization = false } = {}) => {
  if (!requests?.length) return requests;

  const rows = await LeaveRequest.aggregate([
    { $match: { _id: { $in: requests.map((request) => request._id) } } },
    {
      $lookup: {
        from: StaffProfile.collection.name,
        localField: "staffId",
        foreignField: "_id",
        pipeline: [
          {
            $lookup: {
              from: User.collection.name,
              localField: "userId",
              foreignField: "_id",
              pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
              as: "user",
            },
          },
          {
            $project: {
              employeeCode: 1,
              name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
              email: { $ifNull: [{ $arrayElemAt: ["$user.email", 0] }, ""] },
            },
          },
        ],
        as: "staff",
      },
    },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1, code: 1, status: 1 } }],
        as: "branch",
      },
    },
    ...(withOrganization
      ? [
          {
            $lookup: {
              from: Organization.collection.name,
              localField: "organizationId",
              foreignField: "_id",
              pipeline: [{ $project: { _id: 1, name: 1, status: 1 } }],
              as: "organization",
            },
          },
        ]
      : []),
    userLookup("decidedBy", "decidedByUser"),
    userLookup("recordedByUserId", "recordedByUser"),
    userLookup("createdBy", "createdByUser"),
    {
      $addFields: {
        staff: { $ifNull: [{ $arrayElemAt: ["$staff", 0] }, null] },
        branch: { $ifNull: [{ $arrayElemAt: ["$branch", 0] }, null] },
        ...(withOrganization
          ? { organization: { $ifNull: [{ $arrayElemAt: ["$organization", 0] }, null] } }
          : {}),
        decidedByUser: { $ifNull: [{ $arrayElemAt: ["$decidedByUser", 0] }, null] },
        recordedByUser: { $ifNull: [{ $arrayElemAt: ["$recordedByUser", 0] }, null] },
        createdByUser: { $ifNull: [{ $arrayElemAt: ["$createdByUser", 0] }, null] },
      },
    },
  ]);

  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return requests.map((request) => byId.get(String(request._id)) || request);
};

const assertObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError("invalid_id", 400);
  }
};

const getLeaveRequestOrThrow = async (requestId, organizationId) => {
  assertObjectId(requestId);
  const request = await LeaveRequest.findById(requestId).lean();
  if (!request) throw new AppError("leave_request_not_found", 404);

  if (
    request.organizationId &&
    String(request.organizationId) === String(organizationId)
  ) {
    return request;
  }

  const profile = await StaffProfile.findById(request.staffId)
    .select("organizationId")
    .lean();

  if (!profile || String(profile.organizationId) !== String(organizationId)) {
    throw new AppError("leave_request_not_found", 404);
  }

  return request;
};

const staffBranchForScope = async (staffId) => {
  const profile = await StaffProfile.findById(staffId).select("branchId").lean();
  return profile?.branchId || null;
};

const adjustEntitlementPending = async (
  { staffId, organizationId, year, leaveType, delta },
  session
) => {
  if (!usesHolidayBalance(leaveType) || delta === 0) return;

  const entitlement = await getOrCreateEntitlement({
    staffId,
    organizationId,
    year,
    leaveType,
  });

  entitlement.pendingDays = Math.max(0, entitlement.pendingDays + delta);
  await entitlement.save({ session });
};

const adjustEntitlementTaken = async (
  { staffId, organizationId, year, leaveType, delta },
  session
) => {
  if (!usesHolidayBalance(leaveType) || delta === 0) return;

  const entitlement = await getOrCreateEntitlement({
    staffId,
    organizationId,
    year,
    leaveType,
  });

  entitlement.takenDays = Math.max(0, entitlement.takenDays + delta);
  entitlement.pendingDays = Math.max(0, entitlement.pendingDays - delta);
  await entitlement.save({ session });
};

const createLeaveRequest = async ({
  userId,
  organizationId,
  leaveType,
  startDate,
  endDate,
  totalDays,
  reason,
  attachmentUrl,
}) => {
  const profile = await requireStaffProfile(userId, organizationId);
  if (profile.branchId) {
    const branch = await Branch.findOne({
      _id: profile.branchId,
      organizationId,
    })
      .select("settings.enableLeaveRequests")
      .lean();
    if (branch?.settings?.enableLeaveRequests === false) {
      throw new AppError("leave_requests_disabled_for_site", 403);
    }
  }
  assertKnownLeaveType(leaveType);
  const dates = parseLeaveDates(startDate, endDate);

  if (totalDays == null || totalDays <= 0) {
    throw new AppError("invalid_leave_total_days", 400);
  }

  const year = entitlementYearFromDate(dates.startDate);
  const type = leaveType || LeaveType.ANNUAL;
  if (!STAFF_REQUESTABLE_TYPES.includes(type)) {
    throw new AppError("staff_leave_type_not_allowed", 400);
  }
  await assertNoOverlap(profile._id, dates.startDate, dates.endDate);
  await assertSufficientBalance({
    staffId: profile._id,
    organizationId,
    year,
    leaveType: type,
    totalDays,
  });

  const request = await LeaveRequest.create({
    staffId: profile._id,
    organizationId,
    leaveType: type,
    startDate: dates.startDate,
    endDate: dates.endDate,
    totalDays,
    reason: reason || "",
    attachmentUrl: attachmentUrl || "",
    status: LeaveRequestStatus.PENDING,
    source: LeaveRequestSource.STAFF_REQUEST,
    createdBy: userId,
  });

  return request.toObject();
};

const listMyLeaveRequests = async ({
  userId,
  organizationId,
  page,
  limit,
  skip,
  status,
  leaveType,
}) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const match = { staffId: profile._id };
  if (status) match.status = status;
  if (leaveType) match.leaveType = leaveType;

  const { data, meta } = await paginateWithFacet({
    model: LeaveRequest,
    match,
    page,
    limit,
    skip,
    sort: { startDate: -1 },
  });

  return { data: await attachLeaveRequestDetails(data), meta };
};

const getMyLeaveRequest = async ({ userId, organizationId, requestId }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const request = await LeaveRequest.findOne({
    _id: requestId,
    staffId: profile._id,
  }).lean();

  if (!request) throw new AppError("leave_request_not_found", 404);
  const [enriched] = await attachLeaveRequestDetails([request], {
    withOrganization: true,
  });
  return enriched;
};

const cancelLeaveRequest = async ({ userId, organizationId, requestId }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const request = await LeaveRequest.findOne({
    _id: requestId,
    staffId: profile._id,
    status: { $in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] },
  });

  if (!request) throw new AppError("leave_request_not_found", 404);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (request.status === LeaveRequestStatus.APPROVED) {
      const year = entitlementYearFromDate(request.startDate);
      await adjustEntitlementPending(
        {
          staffId: request.staffId,
          organizationId,
          year,
          leaveType: request.leaveType,
          delta: -request.totalDays,
        },
        session
      );
    }

    request.status = LeaveRequestStatus.CANCELLED;
    await request.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  return request.toObject();
};

const listMyEntitlements = async ({ userId, organizationId, year }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const match = { staffId: profile._id };
  if (year) match.year = year;

  const entitlements = await LeaveEntitlement.find(match)
    .sort({ year: -1, leaveType: 1 })
    .lean();

  return entitlements.map((row) => ({
    ...row,
    remainingDays: remainingDays(row),
  }));
};

const listMyLeaveScores = async ({ userId, organizationId, from, to }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const range = parseScoreRange(from, to);
  const [row] = await LeaveRequest.aggregate([
    { $match: scoreMatch([profile._id], range.from, range.to) },
    { $group: scoreGroup },
  ]);

  return {
    from: range.from,
    to: range.to,
    ...emptyScore(profile._id),
    ...shapeScore(row || { _id: profile._id }),
  };
};

const listLeaveScores = async ({
  organizationId,
  page,
  limit,
  skip,
  branchId,
  staffId,
  from,
  to,
  actor,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });

  const range = parseScoreRange(from, to);
  const period = { from: range.from, to: range.to };

  if (!staffIds.length) {
    return {
      data: [],
      meta: { page, limit, total: 0, totalPages: 0, ...period },
    };
  }

  const [facet] = await LeaveRequest.aggregate([
    { $match: scoreMatch(staffIds, range.from, range.to) },
    { $group: scoreGroup },
    {
      $facet: {
        data: [
          { $sort: { sickDays: -1, absenceDays: -1 } },
          { $skip: skip },
          { $limit: limit },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = facet.total[0]?.count || 0;
  const data = await attachScoreStaff((facet.data || []).map(shapeScore));

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: limit ? Math.ceil(total / limit) : 1,
      ...period,
    },
  };
};

const LEAVE_REQUEST_STATUSES = Object.values(LeaveRequestStatus);

const emptyLeaveStatusCounts = () =>
  Object.fromEntries(LEAVE_REQUEST_STATUSES.map((status) => [status, 0]));

/** Tab counts ignore `status` so each status total stays independent of the list filter. */
const leaveStatusCountFacets = (countMatch) =>
  Object.fromEntries(
    LEAVE_REQUEST_STATUSES.map((status) => [
      `${status}Count`,
      [{ $match: { ...countMatch, status } }, { $count: "count" }],
    ])
  );

const leaveStatusCountsFromFacet = (result) =>
  Object.fromEntries(
    LEAVE_REQUEST_STATUSES.map((status) => [status, facetCount(result[`${status}Count`])])
  );

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Staff in scope whose user name or email matches the keyword. */
const staffIdsMatchingKeyword = async (staffIds, keyword) => {
  const term = String(keyword || "").trim();
  if (!term || !staffIds.length) return staffIds;

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

const parseLeaveRequestStatus = (status) => {
  if (status == null || String(status).trim() === "" || String(status).trim() === "all") {
    return undefined;
  }
  const value = String(status).trim();
  if (!LEAVE_REQUEST_STATUSES.includes(value)) {
    throw new AppError("invalid_leave_request_status", 400);
  }
  return value;
};

const listLeaveRequests = async ({
  organizationId,
  page,
  limit,
  skip,
  branchId,
  staffId,
  status,
  leaveType,
  from,
  to,
  keyword,
  actor,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });

  const matchedStaffIds = await staffIdsMatchingKeyword(staffIds, keyword);
  if (!matchedStaffIds.length) {
    return {
      data: [],
      meta: { page, limit, total: 0, totalPages: 0, counts: emptyLeaveStatusCounts() },
    };
  }

  const match = { staffId: { $in: matchedStaffIds } };
  const leaveStatus = parseLeaveRequestStatus(status);
  if (leaveType) match.leaveType = leaveType;

  if (from || to) {
    match.startDate = {};
    if (from) match.startDate.$gte = moment.tz(from, DEFAULT_TZ).startOf("day").toDate();
    if (to) match.startDate.$lte = moment.tz(to, DEFAULT_TZ).endOf("day").toDate();
  }

  const countMatch = { ...match };
  if (leaveStatus) match.status = leaveStatus;

  const { data, meta, result } = await paginateWithFacet({
    model: LeaveRequest,
    match,
    page,
    limit,
    skip,
    sort: { startDate: -1 },
    extraFacets: leaveStatusCountFacets(countMatch),
  });

  return {
    data: await attachLeaveRequestDetails(data),
    meta: { ...meta, counts: leaveStatusCountsFromFacet(result) },
  };
};

const getLeaveRequest = async ({ requestId, organizationId, actor }) => {
  const request = await getLeaveRequestOrThrow(requestId, organizationId);

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    assertMayManageStaff(
      standing,
      request.branchId || (await staffBranchForScope(request.staffId))
    );
  }

  const [enriched] = await attachLeaveRequestDetails([request], {
    withOrganization: true,
  });
  return enriched;
};

const approveLeaveRequest = async ({
  actor,
  organizationId,
  requestId,
  decisionNote,
  managerStaffId = null,
}) => {
  assertObjectId(requestId);
  const request = await LeaveRequest.findOne({
    _id: requestId,
    status: LeaveRequestStatus.PENDING,
  });

  if (!request) throw new AppError("leave_request_not_found", 404);
  await getLeaveRequestOrThrow(requestId, organizationId);

  const standing = await actorStanding(actor, organizationId);
  const scopeBranch =
    request.branchId || (await staffBranchForScope(request.staffId));
  await assertMayApproveForStaff({
    standing,
    actor,
    organizationId,
    branchId: scopeBranch,
    targetStaffId: request.staffId,
    managerStaffId,
  });

  const year = entitlementYearFromDate(request.startDate);
  await assertSufficientBalance({
    staffId: request.staffId,
    organizationId,
    year,
    leaveType: request.leaveType,
    totalDays: request.totalDays,
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await adjustEntitlementPending(
      {
        staffId: request.staffId,
        organizationId,
        year,
        leaveType: request.leaveType,
        delta: request.totalDays,
      },
      session
    );

    request.status = LeaveRequestStatus.APPROVED;
    request.decidedBy = actor._id;
    request.decidedAt = new Date();
    request.decisionNote = decisionNote || "";
    await request.save({ session });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  await notifyStaff({
    staffId: request.staffId,
    subjectId: actor._id,
    type: "leaveRequestUpdate",
    objectId: request._id,
    objectType: "leaveRequest",
    title: "Leave request approved",
    body: `Your ${request.leaveType} leave from ${dayOf(request.startDate)} to ${dayOf(request.endDate)} was approved.`,
  });

  const [enriched] = await attachLeaveRequestDetails([request.toObject()]);
  return enriched;
};

const rejectLeaveRequest = async ({
  actor,
  organizationId,
  requestId,
  decisionNote,
  managerStaffId = null,
}) => {
  assertObjectId(requestId);
  const request = await LeaveRequest.findOne({
    _id: requestId,
    status: LeaveRequestStatus.PENDING,
  });

  if (!request) throw new AppError("leave_request_not_found", 404);
  await getLeaveRequestOrThrow(requestId, organizationId);

  const standing = await actorStanding(actor, organizationId);
  await assertMayApproveForStaff({
    standing,
    actor,
    organizationId,
    branchId: request.branchId || (await staffBranchForScope(request.staffId)),
    targetStaffId: request.staffId,
    managerStaffId,
  });

  request.status = LeaveRequestStatus.REJECTED;
  request.decidedBy = actor._id;
  request.decidedAt = new Date();
  request.decisionNote = decisionNote || "";
  await request.save();

  await notifyStaff({
    staffId: request.staffId,
    subjectId: actor._id,
    type: "leaveRequestUpdate",
    objectId: request._id,
    objectType: "leaveRequest",
    title: "Leave request rejected",
    body: `Your ${request.leaveType} leave from ${dayOf(request.startDate)} to ${dayOf(request.endDate)} was not approved.`,
  });

  const [enriched] = await attachLeaveRequestDetails([request.toObject()]);
  return enriched;
};

const recordManagerLeave = async ({
  actor,
  organizationId,
  staffId,
  leaveType,
  startDate,
  endDate,
  totalDays,
  reason,
}) => {
  const profile = await getStaffProfileOrThrow(staffId, organizationId);
  assertKnownLeaveType(leaveType);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, profile.branchId);

  const dates = parseLeaveDates(startDate, endDate, { allowPast: true });
  if (totalDays == null || totalDays <= 0) {
    throw new AppError("invalid_leave_total_days", 400);
  }

  const year = entitlementYearFromDate(dates.startDate);
  const type = leaveType || LeaveType.SICK;
  if (!MANAGER_RECORDABLE_TYPES.includes(type)) {
    throw new AppError("manager_leave_type_not_allowed", 400);
  }

  await assertNoOverlap(profile._id, dates.startDate, dates.endDate);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const request = await LeaveRequest.create(
      [
        {
          staffId: profile._id,
          organizationId,
          leaveType: type,
          startDate: dates.startDate,
          endDate: dates.endDate,
          totalDays,
          reason: reason || "",
          status: LeaveRequestStatus.CLOSED,
          source: LeaveRequestSource.MANAGER_RECORDED,
          recordedByUserId: actor._id,
          createdBy: actor._id,
        },
      ],
      { session }
    );

    if (usesHolidayBalance(type)) {
      const entitlement = await getOrCreateEntitlement({
        staffId: profile._id,
        organizationId,
        year,
        leaveType: type,
      });
      entitlement.takenDays += totalDays;
      await entitlement.save({ session });
    }

    await session.commitTransaction();
    const [enriched] = await attachLeaveRequestDetails([request[0].toObject()]);
    return enriched;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const closeLeaveRequest = async ({ actor, organizationId, requestId }) => {
  assertObjectId(requestId);
  const request = await LeaveRequest.findOne({
    _id: requestId,
    status: LeaveRequestStatus.APPROVED,
  });

  if (!request) throw new AppError("leave_request_not_found", 404);
  await getLeaveRequestOrThrow(requestId, organizationId);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(
    standing,
    request.branchId || (await staffBranchForScope(request.staffId))
  );

  const year = entitlementYearFromDate(request.startDate);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await adjustEntitlementTaken(
      {
        staffId: request.staffId,
        organizationId,
        year,
        leaveType: request.leaveType,
        delta: request.totalDays,
      },
      session
    );

    request.status = LeaveRequestStatus.CLOSED;
    await request.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  const [enriched] = await attachLeaveRequestDetails([request.toObject()]);
  return enriched;
};

const listEntitlements = async ({
  organizationId,
  page,
  limit,
  skip,
  branchId,
  staffId,
  year,
  leaveType,
  actor,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });

  if (!staffIds.length) {
    return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }

  const match = { staffId: { $in: staffIds } };
  if (year) match.year = year;
  if (leaveType) match.leaveType = leaveType;

  const { data, meta } = await paginateWithFacet({
    model: LeaveEntitlement,
    match,
    page,
    limit,
    skip,
    sort: { year: -1, leaveType: 1 },
  });

  return {
    data: data.map((row) => ({ ...row, remainingDays: remainingDays(row) })),
    meta,
  };
};

const upsertEntitlement = async ({
  actor,
  organizationId,
  staffId,
  year,
  leaveType,
  entitlementDays,
  carriedOverDays,
  recalculate,
  fullYearDays,
}) => {
  const profile = await getStaffProfileOrThrow(staffId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, profile.branchId);
  assertKnownLeaveType(leaveType);

  const type = leaveType || LeaveType.ANNUAL;
  const yearLabel = year || entitlementYearFromDate();

  let days = entitlementDays;
  let calculation = null;

  if (recalculate || days == null) {
    calculation = calculateHolidayEntitlement({
      startDate: profile.startDate,
      contractedWeeklyHours: profile.contractedWeeklyHours,
      year: yearLabel,
      fullYearDays: fullYearDays || DEFAULT_FULL_YEAR_HOLIDAY_DAYS,
    });
    days = calculation.entitlementDays;
  }

  if (days == null || days < 0) {
    throw new AppError("invalid_leave_entitlement_days", 400);
  }

  const entitlement = await LeaveEntitlement.findOneAndUpdate(
    { staffId: profile._id, year: yearLabel, leaveType: type },
    {
      $set: {
        organizationId,
        branchId: profile.branchId,
        entitlementDays: days,
        carriedOverDays: carriedOverDays ?? 0,
      },
      $setOnInsert: {
        takenDays: 0,
        pendingDays: 0,
      },
    },
    { upsert: true, new: true }
  ).lean();

  return {
    ...entitlement,
    remainingDays: remainingDays(entitlement),
    calculation,
  };
};

module.exports = {
  createLeaveRequest,
  listMyLeaveRequests,
  getMyLeaveRequest,
  cancelLeaveRequest,
  listMyEntitlements,
  listMyLeaveScores,
  listLeaveScores,
  listLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  recordManagerLeave,
  closeLeaveRequest,
  listEntitlements,
  upsertEntitlement,
  calculateHolidayEntitlement,
  entitlementYearFromDate,
};
