const { Membership } = require("@models/Membership");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { AppError } = require("@services/_errors/AppError");
const {
  MembershipRole,
  ActiveInactiveStatus,
} = require("@models/domainEnums");

const ROLE_RANK = {
  [MembershipRole.SUPER_ADMIN]: 5,
  [MembershipRole.OWNER]: 4,
  [MembershipRole.SITE_MANAGER]: 3,
  [MembershipRole.LINE_MANAGER]: 2,
  [MembershipRole.STAFF]: 1,
};

/** Site-wide / org-wide managers (not Line Manager). */
const MANAGER_ROLES = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

/** Roles allowed on team approve/reject routes (leave, attendance corrections). */
const TEAM_APPROVER_ROLES = [
  ...MANAGER_ROLES,
  MembershipRole.LINE_MANAGER,
];

/** Clock-in / rota profile. Owner and Site Manager are manager logins only. */
const STAFF_PROFILE_ROLES = [
  MembershipRole.STAFF,
  MembershipRole.LINE_MANAGER,
];

const isPlatformAdmin = (actor) => actor?.userType === "admin";

const actorStanding = async (actor, organizationId) => {
  if (isPlatformAdmin(actor)) {
    return { role: MembershipRole.SUPER_ADMIN, branchId: null, rank: 5 };
  }

  const memberships = await Membership.find({
    userId: actor._id,
    organizationId,
    status: ActiveInactiveStatus.ACTIVE,
  }).lean();

  if (!memberships.length) throw new AppError("no_membership_for_scope", 403);

  const best = memberships.reduce((a, b) =>
    ROLE_RANK[b.role] > ROLE_RANK[a.role] ? b : a
  );

  return { role: best.role, branchId: best.branchId, rank: ROLE_RANK[best.role] };
};

const assertMayManageStaff = (standing, branchId) => {
  if (!MANAGER_ROLES.includes(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }

  if (standing.role === MembershipRole.SITE_MANAGER) {
    if (!branchId || String(standing.branchId) !== String(branchId)) {
      throw new AppError("outside_managed_branch", 403);
    }
  }
};

/**
 * Owner / Site Manager: branch-scoped manage rules.
 * Line Manager: only the staff who report to them (and same branch when scoped).
 *
 * Pass `managerStaffId` when `hasReports` already resolved the caller's profile
 * so we skip a second StaffProfile lookup.
 */
const assertMayApproveForStaff = async ({
  standing,
  actor,
  organizationId,
  branchId,
  targetStaffId,
  managerStaffId = null,
}) => {
  if (MANAGER_ROLES.includes(standing.role)) {
    assertMayManageStaff(standing, branchId);
    return;
  }

  if (standing.role !== MembershipRole.LINE_MANAGER) {
    throw new AppError("insufficient_role", 403);
  }

  if (
    standing.branchId &&
    branchId &&
    String(standing.branchId) !== String(branchId)
  ) {
    throw new AppError("outside_managed_branch", 403);
  }

  let managerId = managerStaffId;
  if (!managerId) {
    const manager = await StaffProfile.findOne({
      userId: actor._id,
      organizationId,
    })
      .select("_id")
      .lean();
    if (!manager) throw new AppError("staff_profile_not_found", 403);
    managerId = manager._id;
  }

  const target = await StaffProfile.findOne({
    _id: targetStaffId,
    organizationId,
  })
    .select("reportsToStaffId supervisorStaffId branchId")
    .lean();

  if (!target) throw new AppError("staff_profile_not_found", 404);

  if (String(target.reportsToStaffId) !== String(managerId)) {
    throw new AppError("not_direct_report", 403);
  }
};

/** Supervision is conducted by supervisorStaffId, not the org-chart line manager. */
const assertMaySuperviseStaff = async ({
  standing,
  actor,
  organizationId,
  branchId,
  targetStaffId,
  managerStaffId = null,
}) => {
  if (MANAGER_ROLES.includes(standing.role)) {
    assertMayManageStaff(standing, branchId);
    return;
  }

  if (standing.role !== MembershipRole.LINE_MANAGER) {
    throw new AppError("insufficient_role", 403);
  }

  if (
    standing.branchId &&
    branchId &&
    String(standing.branchId) !== String(branchId)
  ) {
    throw new AppError("outside_managed_branch", 403);
  }

  let managerId = managerStaffId;
  if (!managerId) {
    const manager = await StaffProfile.findOne({
      userId: actor._id,
      organizationId,
    })
      .select("_id")
      .lean();
    if (!manager) throw new AppError("staff_profile_not_found", 403);
    managerId = manager._id;
  }

  const target = await StaffProfile.findOne({
    _id: targetStaffId,
    organizationId,
  })
    .select("supervisorStaffId branchId")
    .lean();

  if (!target) throw new AppError("staff_profile_not_found", 404);

  if (String(target.supervisorStaffId) !== String(managerId)) {
    throw new AppError("not_assigned_supervisor", 403);
  }
};

const assertBranchInOrganization = async (branchId, organizationId) => {
  if (!branchId) return;
  const branch = await Branch.exists({ _id: branchId, organizationId });
  if (!branch) throw new AppError("branch_not_found", 404);
};

const scopeBranchFilter = (standing, branchId) => {
  if (
    standing.role === MembershipRole.SITE_MANAGER ||
    standing.role === MembershipRole.LINE_MANAGER
  ) {
    return standing.branchId;
  }
  return branchId || null;
};

/**
 * Live direct reports for a manager in one org. Never cached.
 * Resolves userId → StaffProfile, then staff where reportsToStaffId = that profile.
 */
const resolveSubordinates = async ({
  userId,
  organizationId,
  managerStaffId = null,
}) => {
  let managerId = managerStaffId;

  if (!managerId) {
    if (!userId || !organizationId) return [];

    const manager = await StaffProfile.findOne({
      userId,
      organizationId,
    })
      .select("_id")
      .lean();

    if (!manager) return [];
    managerId = manager._id;
  }

  return StaffProfile.find({
    organizationId,
    reportsToStaffId: managerId,
  })
    .select("_id userId branchId employeeCode status")
    .lean();
};

const resolveSuperviseeStaffIds = async ({ userId, organizationId }) => {
  if (!userId || !organizationId) return [];
  const manager = await StaffProfile.findOne({ userId, organizationId })
    .select("_id")
    .lean();
  if (!manager) return [];
  return StaffProfile.find({
    organizationId,
    supervisorStaffId: manager._id,
  }).distinct("_id");
};

/** Same as resolveSubordinates, but only StaffProfile ids (for query filters). */
const resolveSubordinateStaffIds = async (args) => {
  const rows = await resolveSubordinates(args);
  return rows.map((row) => row._id);
};

/**
 * Staff may only list their own profile.
 * Returns false when the page must be empty (no profile, or staffId is someone else).
 * Other roles keep the staffId they passed.
 */
const scopeStaffIdForActor = async ({ standing, actor, organizationId, staffId }) => {
  if (standing.role !== MembershipRole.STAFF) return staffId;

  const profile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
  })
    .select("_id")
    .lean();
  if (!profile) return false;
  if (staffId && String(staffId) !== String(profile._id)) return false;
  return profile._id;
};

/** Staff ids the actor may see for leave / attendance registers. */
const resolveScopedStaffIds = async ({
  standing,
  actor,
  organizationId,
  staffId = null,
  branchId = null,
}) => {
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  const staffMatch = { organizationId };
  if (scopedBranchId) staffMatch.branchId = scopedBranchId;

  if (standing.role === MembershipRole.LINE_MANAGER) {
    const teamIds = await resolveSubordinateStaffIds({
      userId: actor._id,
      organizationId,
    });
    if (!teamIds.length) return [];
    if (staffId && !teamIds.some((id) => String(id) === String(staffId))) {
      return [];
    }
    staffMatch._id = staffId || { $in: teamIds };
  } else if (staffId) {
    staffMatch._id = staffId;
  }

  return StaffProfile.find(staffMatch).distinct("_id");
};

const resolveScopedSuperviseeIds = async ({
  standing,
  actor,
  organizationId,
  staffId = null,
  branchId = null,
}) => {
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  const staffMatch = { organizationId };
  if (scopedBranchId) staffMatch.branchId = scopedBranchId;

  if (standing.role === MembershipRole.LINE_MANAGER) {
    const teamIds = await resolveSuperviseeStaffIds({
      userId: actor._id,
      organizationId,
    });
    if (!teamIds.length) return [];
    if (staffId && !teamIds.some((id) => String(id) === String(staffId))) {
      return [];
    }
    staffMatch._id = staffId || { $in: teamIds };
  } else if (staffId) {
    staffMatch._id = staffId;
  }

  return StaffProfile.find(staffMatch).distinct("_id");
};

const applyLineManagerStaffScope = async ({
  match,
  standing,
  actor,
  organizationId,
  staffId = null,
  staffIdField = "staffId",
}) => {
  if (standing.role !== MembershipRole.LINE_MANAGER) {
    if (staffId) match[staffIdField] = staffId;
    return true;
  }

  const teamIds = await resolveSubordinateStaffIds({
    userId: actor._id,
    organizationId,
  });

  if (!teamIds.length) return false;

  if (staffId) {
    const allowed = teamIds.some((id) => String(id) === String(staffId));
    if (!allowed) return false;
    match[staffIdField] = staffId;
    return true;
  }

  match[staffIdField] = { $in: teamIds };
  return true;
};

const duplicateKey = (error) =>
  error?.code === 11000 || error?.code === 11001;

const assertOneActiveMembershipPerOrg = async (userId, organizationId) => {
  const exists = await Membership.exists({
    userId,
    organizationId,
    status: ActiveInactiveStatus.ACTIVE,
  });
  if (exists) throw new AppError("membership_already_exists", 409);
};

const assertRoleMayHaveStaffProfile = (role) => {
  if (!STAFF_PROFILE_ROLES.includes(role)) {
    throw new AppError("manager_cannot_have_staff_profile", 400);
  }
};

module.exports = {
  MANAGER_ROLES,
  TEAM_APPROVER_ROLES,
  STAFF_PROFILE_ROLES,
  actorStanding,
  assertMayManageStaff,
  assertOneActiveMembershipPerOrg,
  assertRoleMayHaveStaffProfile,
  assertMayApproveForStaff,
  assertMaySuperviseStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  resolveSubordinates,
  resolveSubordinateStaffIds,
  applyLineManagerStaffScope,
  resolveScopedStaffIds,
  resolveSuperviseeStaffIds,
  resolveScopedSuperviseeIds,
  scopeStaffIdForActor,
  duplicateKey,
};
