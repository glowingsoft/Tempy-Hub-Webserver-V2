const mongoose = require("mongoose");
const { LeaveRequest } = require("@models/LeaveRequest");
const { LeaveEntitlement } = require("@models/LeaveEntitlement");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { paginateWithFacet } = require("@utils/paginate");
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

const usesHolidayBalance = (leaveType) => leaveType === LeaveType.ANNUAL;

const ACTIVE_REQUEST_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
];

const parseLeaveDates = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError("invalid_leave_dates", 400);
  }
  if (end < start) throw new AppError("leave_end_before_start", 400);
  return { startDate: start, endDate: end };
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
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  // UK-style leave year starting April; label as YYYY-YYYY+1 when on/after April
  if (month >= 3) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
};

const leaveYearBounds = (yearLabel) => {
  const startYear = Number(String(yearLabel).split("-")[0]);
  const start = new Date(Date.UTC(startYear, 3, 1));
  const end = new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999));
  return { start, end };
};

const daysBetweenUtc = (from, to) => {
  const ms = startOfUtcDay(to) - startOfUtcDay(from);
  return Math.max(0, Math.round(ms / 86400000) + 1);
};

const startOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
  const yearLabel = year || entitlementYearFromDate(startDate || new Date());
  const { start: yearStart, end: yearEnd } = leaveYearBounds(yearLabel);
  const yearDays = daysBetweenUtc(yearStart, yearEnd);

  const employedFrom = startDate
    ? new Date(Math.max(startOfUtcDay(startDate).getTime(), yearStart.getTime()))
    : yearStart;
  const employedDays = daysBetweenUtc(employedFrom, yearEnd);
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
    status: { $in: ACTIVE_REQUEST_STATUSES },
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

const attachLeaveRequestDetails = async (requests) => {
  if (!requests?.length) return requests;

  const staffIds = [...new Set(requests.map((r) => String(r.staffId)))];
  const branchIds = [
    ...new Set(requests.filter((r) => r.branchId).map((r) => String(r.branchId))),
  ];

  const [staffProfiles, branches] = await Promise.all([
    StaffProfile.find({ _id: { $in: staffIds } })
      .select("_id userId employeeCode")
      .lean(),
    Branch.find({ _id: { $in: branchIds } })
      .select("_id name code status")
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

  return requests.map((request) => ({
    ...request,
    staff: staffSummary(staffById.get(String(request.staffId)), userById),
    branch: branchById.get(String(request.branchId)) || null,
  }));
};

const getLeaveRequestOrThrow = async (requestId, organizationId) => {
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
  const [enriched] = await attachLeaveRequestDetails([request]);
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
  if (status) match.status = status;
  if (leaveType) match.leaveType = leaveType;

  if (from || to) {
    match.startDate = {};
    if (from) match.startDate.$gte = new Date(from);
    if (to) match.startDate.$lte = new Date(to);
  }

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

const getLeaveRequest = async ({ requestId, organizationId, actor }) => {
  const request = await getLeaveRequestOrThrow(requestId, organizationId);

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    assertMayManageStaff(
      standing,
      request.branchId || (await staffBranchForScope(request.staffId))
    );
  }

  const [enriched] = await attachLeaveRequestDetails([request]);
  return enriched;
};

const approveLeaveRequest = async ({
  actor,
  organizationId,
  requestId,
  decisionNote,
  managerStaffId = null,
}) => {
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

  const dates = parseLeaveDates(startDate, endDate);
  if (totalDays == null || totalDays <= 0) {
    throw new AppError("invalid_leave_total_days", 400);
  }

  const year = entitlementYearFromDate(dates.startDate);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const type = leaveType || LeaveType.SICK;
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
  const yearLabel = year || entitlementYearFromDate(new Date());

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
        entitlementDays: days,
        carriedOverDays: carriedOverDays ?? 0,
      },
      $setOnInsert: {
        staffId: profile._id,
        organizationId,
        year: yearLabel,
        leaveType: type,
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
