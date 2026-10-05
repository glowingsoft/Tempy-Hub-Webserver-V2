const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Shift } = require("@models/Shift");
const { ShiftClaim } = require("@models/ShiftClaim");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  ShiftStatus,
  ShiftVisibility,
  ShiftClaimStatus,
  StaffProfileStatus,
  ModuleSlug,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./shiftAccess");

const EARLY_CLOCK_IN_MINUTES = 15;
const DEFAULT_TZ = "Europe/London";

const branchTimezone = async (branchId) => {
  const branch = await Branch.findById(branchId).select("timezone").lean();
  return branch?.timezone || DEFAULT_TZ;
};

const toZoneMoment = (value, timezone) => {
  const tz = timezone || DEFAULT_TZ;
  if (value instanceof Date) return moment(value).tz(tz);
  const raw = String(value).trim();
  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    return moment.parseZone(raw).tz(tz);
  }
  return moment.tz(raw, tz);
};

const parseShiftTimes = (
  startsAt,
  endsAt,
  timezone,
  { requireFutureStart = true } = {}
) => {
  const tz = timezone || DEFAULT_TZ;
  const start = toZoneMoment(startsAt, tz);
  const end = toZoneMoment(endsAt, tz);

  if (!start.isValid() || !end.isValid()) {
    throw new AppError("invalid_shift_times", 400);
  }
  if (!end.isAfter(start)) throw new AppError("shift_end_before_start", 400);
  if (requireFutureStart && start.isBefore(moment.tz(tz))) {
    throw new AppError("shift_starts_in_past", 400);
  }

  return { startsAt: start.toDate(), endsAt: end.toDate() };
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

const branchSummary = (branch) =>
  branch
    ? { _id: branch._id, name: branch.name, code: branch.code, status: branch.status }
    : null;

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

const attachShiftDetails = async (shifts) => {
  if (!shifts?.length) return shifts;

  const branchIds = [...new Set(shifts.map((s) => String(s.branchId)))];
  const staffIds = [
    ...new Set(
      shifts.filter((s) => s.staffId).map((s) => String(s.staffId))
    ),
  ];

  const [branches, staffProfiles] = await Promise.all([
    Branch.find({ _id: { $in: branchIds } })
      .select("_id name code status")
      .lean(),
    staffIds.length
      ? StaffProfile.find({ _id: { $in: staffIds } })
          .select("_id userId employeeCode")
          .lean()
      : [],
  ]);

  const userIds = staffProfiles.map((p) => p.userId);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("name email")
        .lean()
    : [];

  const branchById = new Map(branches.map((b) => [String(b._id), b]));
  const staffById = new Map(staffProfiles.map((p) => [String(p._id), p]));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return shifts.map((shift) => ({
    ...shift,
    branch: branchSummary(branchById.get(String(shift.branchId))),
    staff: shift.staffId
      ? staffSummary(staffById.get(String(shift.staffId)), userById)
      : null,
  }));
};

const getShiftOrThrow = async (shiftId, organizationId) => {
  const shift = await Shift.findOne({ _id: shiftId, organizationId }).lean();
  if (!shift) throw new AppError("shift_not_found", 404);
  return shift;
};

const createShift = async ({
  actor,
  organizationId,
  branchId,
  startsAt,
  endsAt,
  staffId,
  visibility,
  urgentCover,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (!scopedBranchId) throw new AppError("branch_scope_required", 400);

  assertMayManageStaff(standing, scopedBranchId);
  await assertBranchInOrganization(scopedBranchId, organizationId);

  const timezone = await branchTimezone(scopedBranchId);
  const times = parseShiftTimes(startsAt, endsAt, timezone);

  if (staffId) {
    const profile = await StaffProfile.findOne({
      _id: staffId,
      organizationId,
      status: StaffProfileStatus.ACTIVE,
    }).lean();
    if (!profile) throw new AppError("staff_profile_not_found", 404);
    if (String(profile.branchId) !== String(scopedBranchId)) {
      throw new AppError("staff_not_in_branch", 400);
    }
  }

  const isOpen = !staffId;
  const shift = await Shift.create({
    organizationId,
    branchId: scopedBranchId,
    staffId: staffId || null,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    status: isOpen ? ShiftStatus.OPEN : ShiftStatus.SCHEDULED,
    visibility: visibility || ShiftVisibility.BRANCH,
    urgentCover: Boolean(urgentCover),
    openedAt: isOpen ? new Date() : null,
  });

  const [withDetails] = await attachShiftDetails([shift.toObject()]);
  return withDetails;
};

const listShifts = async ({
  organizationId,
  page,
  limit,
  skip,
  branchId,
  status,
  staffId,
  from,
  to,
  actor,
}) => {
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    const scopedBranchId = scopeBranchFilter(standing, branchId);
    if (scopedBranchId) {
      match.branchId = new mongoose.Types.ObjectId(String(scopedBranchId));
    } else if (branchId) {
      match.branchId = new mongoose.Types.ObjectId(String(branchId));
    }
  } else if (branchId) {
    match.branchId = new mongoose.Types.ObjectId(String(branchId));
  }

  if (status) match.status = status;
  if (staffId) match.staffId = new mongoose.Types.ObjectId(String(staffId));

  if (from || to) {
    match.startsAt = {};
    if (from) match.startsAt.$gte = new Date(from);
    if (to) match.startsAt.$lte = new Date(to);
  }

  const { data, meta } = await paginateWithFacet({
    model: Shift,
    match,
    page,
    limit,
    skip,
    sort: { startsAt: 1 },
  });

  return {
    data: await attachShiftDetails(data),
    meta,
  };
};

const getShift = async ({ shiftId, organizationId }) => {
  const shift = await getShiftOrThrow(shiftId, organizationId);
  const [withDetails] = await attachShiftDetails([shift]);
  return withDetails;
};

const updateShift = async ({
  actor,
  shiftId,
  organizationId,
  startsAt,
  endsAt,
  staffId,
  status,
  visibility,
  urgentCover,
  open,
}) => {
  const shift = await Shift.findOne({ _id: shiftId, organizationId });
  if (!shift) throw new AppError("shift_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, shift.branchId);

  if (startsAt !== undefined || endsAt !== undefined) {
    const timezone = await branchTimezone(shift.branchId);
    const times = parseShiftTimes(
      startsAt ?? shift.startsAt,
      endsAt ?? shift.endsAt,
      timezone,
      { requireFutureStart: startsAt !== undefined }
    );
    shift.startsAt = times.startsAt;
    shift.endsAt = times.endsAt;
  }

  if (visibility !== undefined) shift.visibility = visibility;
  if (urgentCover !== undefined) shift.urgentCover = Boolean(urgentCover);

  if (open === true) {
    shift.staffId = null;
    shift.status = ShiftStatus.OPEN;
    shift.openedAt = new Date();
    shift.filledAt = null;
    shift.filledByClaimId = null;
  }

  if (staffId !== undefined) {
    if (!staffId) {
      shift.staffId = null;
      shift.status = ShiftStatus.OPEN;
      shift.openedAt = shift.openedAt || new Date();
    } else {
      const profile = await StaffProfile.findOne({
        _id: staffId,
        organizationId,
        status: StaffProfileStatus.ACTIVE,
      }).lean();
      if (!profile) throw new AppError("staff_profile_not_found", 404);
      shift.staffId = staffId;
      shift.status = ShiftStatus.SCHEDULED;
      shift.filledAt = new Date();
    }
  }

  if (status !== undefined) {
    if (!Object.values(ShiftStatus).includes(status)) {
      throw new AppError("invalid_shift_status", 400);
    }
    shift.status = status;
    if (status === ShiftStatus.CANCELLED) {
      shift.staffId = null;
    }
  }

  if (!shift.isModified()) throw new AppError("nothing_to_update", 400);

  await shift.save();
  const [withDetails] = await attachShiftDetails([shift.toObject()]);
  return withDetails;
};

const listMyShifts = async ({ userId, organizationId, from, to }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
    staffId: profile._id,
    status: { $in: [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED] },
  };

  if (from || to) {
    match.startsAt = {};
    if (from) match.startsAt.$gte = new Date(from);
    if (to) match.startsAt.$lte = new Date(to);
  }

  const shifts = await Shift.find(match).sort({ startsAt: 1 }).lean();
  return attachShiftDetails(shifts);
};

const openShiftMatch = (profile, organizationId) => ({
  organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  status: ShiftStatus.OPEN,
  staffId: null,
  $or: [
    { branchId: profile.branchId, visibility: ShiftVisibility.BRANCH },
    { visibility: ShiftVisibility.ORGANIZATION },
  ],
});

const listOpenShifts = async ({ userId, organizationId, from, to }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const match = openShiftMatch(profile, organizationId);

  if (from || to) {
    match.startsAt = {};
    if (from) match.startsAt.$gte = new Date(from);
    if (to) match.startsAt.$lte = new Date(to);
  }

  const shifts = await Shift.find(match).sort({ startsAt: 1 }).lean();
  return attachShiftDetails(shifts);
};

const getActiveShiftForStaff = async ({ staffProfile, organizationId }) => {
  const branch = await Branch.findById(staffProfile.branchId)
    .select("settings.lateGraceMinutes timezone")
    .lean();

  const tz = branch?.timezone || DEFAULT_TZ;
  const now = moment.tz(tz);
  const earliestClockIn = now.clone().add(EARLY_CLOCK_IN_MINUTES, "minutes");

  const shift = await Shift.findOne({
    organizationId,
    staffId: staffProfile._id,
    status: ShiftStatus.SCHEDULED,
    startsAt: { $lte: earliestClockIn.toDate() },
    endsAt: { $gte: now.toDate() },
  })
    .sort({ startsAt: -1 })
    .lean();

  if (!shift) return { shift: null, clockInEligible: false };

  const [withDetails] = await attachShiftDetails([shift]);

  return {
    shift: withDetails,
    clockInEligible: true,
    graceMinutes: branch?.settings?.lateGraceMinutes ?? 5,
  };
};

const getActiveShift = async ({ userId, organizationId }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  return getActiveShiftForStaff({ staffProfile: profile, organizationId });
};

const createClaim = async ({ userId, organizationId, shiftId, note }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const shift = await getShiftOrThrow(shiftId, organizationId);

  if (shift.status !== ShiftStatus.OPEN || shift.staffId) {
    throw new AppError("shift_not_open", 400);
  }

  const visible =
    shift.visibility === ShiftVisibility.ORGANIZATION ||
    String(shift.branchId) === String(profile.branchId);

  if (!visible) throw new AppError("shift_not_visible", 403);

  const existing = await ShiftClaim.findOne({
    shiftId,
    staffId: profile._id,
    status: { $in: [ShiftClaimStatus.PENDING, ShiftClaimStatus.APPROVED] },
  }).lean();

  if (existing) throw new AppError("shift_claim_already_exists", 409);

  const claim = await ShiftClaim.create({
    shiftId,
    organizationId,
    branchId: profile.branchId,
    staffId: profile._id,
    note: note || "",
  });

  return claim.toObject();
};

const withdrawClaim = async ({ userId, organizationId, claimId }) => {
  const profile = await requireStaffProfile(userId, organizationId);
  const claim = await ShiftClaim.findOne({
    _id: claimId,
    organizationId,
    staffId: profile._id,
    status: ShiftClaimStatus.PENDING,
  });

  if (!claim) throw new AppError("shift_claim_not_found", 404);

  claim.status = ShiftClaimStatus.WITHDRAWN;
  await claim.save();
  return claim.toObject();
};

const listClaims = async ({
  organizationId,
  page,
  limit,
  skip,
  status,
  shiftId,
  actor,
}) => {
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };

  if (status) match.status = status;
  if (shiftId) match.shiftId = new mongoose.Types.ObjectId(String(shiftId));

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    if (standing.branchId) {
      match.branchId = standing.branchId;
    }
  }

  const { data, meta } = await paginateWithFacet({
    model: ShiftClaim,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
  });

  return { data, meta };
};

const approveClaim = async ({ actor, organizationId, claimId, decisionNote }) => {
  const claim = await ShiftClaim.findOne({
    _id: claimId,
    organizationId,
    status: ShiftClaimStatus.PENDING,
  });

  if (!claim) throw new AppError("shift_claim_not_found", 404);

  const shift = await Shift.findOne({
    _id: claim.shiftId,
    organizationId,
    status: ShiftStatus.OPEN,
  });

  if (!shift) throw new AppError("shift_not_open", 400);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, shift.branchId);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    claim.status = ShiftClaimStatus.APPROVED;
    claim.decidedBy = actor._id;
    claim.decidedAt = new Date();
    claim.decisionNote = decisionNote || "";
    await claim.save({ session });

    shift.staffId = claim.staffId;
    shift.status = ShiftStatus.SCHEDULED;
    shift.filledAt = new Date();
    shift.filledByClaimId = claim._id;
    await shift.save({ session });

    await ShiftClaim.updateMany(
      {
        shiftId: shift._id,
        _id: { $ne: claim._id },
        status: ShiftClaimStatus.PENDING,
      },
      {
        $set: {
          status: ShiftClaimStatus.REJECTED,
          decidedBy: actor._id,
          decidedAt: new Date(),
          decisionNote: "Another claim was approved",
        },
      },
      { session }
    );

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  const [shiftDetails] = await attachShiftDetails([shift.toObject()]);
  return { claim: claim.toObject(), shift: shiftDetails };
};

const rejectClaim = async ({ actor, organizationId, claimId, decisionNote }) => {
  const claim = await ShiftClaim.findOne({
    _id: claimId,
    organizationId,
    status: ShiftClaimStatus.PENDING,
  });

  if (!claim) throw new AppError("shift_claim_not_found", 404);

  const shift = await Shift.findById(claim.shiftId).select("branchId").lean();
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, shift?.branchId);

  claim.status = ShiftClaimStatus.REJECTED;
  claim.decidedBy = actor._id;
  claim.decidedAt = new Date();
  claim.decisionNote = decisionNote || "";
  await claim.save();

  return claim.toObject();
};

module.exports = {
  createShift,
  listShifts,
  getShift,
  updateShift,
  listMyShifts,
  listOpenShifts,
  getActiveShift,
  getActiveShiftForStaff,
  createClaim,
  withdrawClaim,
  listClaims,
  approveClaim,
  rejectClaim,
  ModuleSlug,
};
