const {
  permissionKey,
  PermissionVerb,
} = require("@adminServices/organizations/permissionCatalogue");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const {
  MANAGER_ROLES,
  actorStanding,
  assertBranchInOrganization,
  scopeBranchFilter: scopeManagerBranch,
} = require("@adminServices/staff/staffAccess");

const RESIDENT_VIEW = permissionKey(ModuleSlug.RESIDENTS, PermissionVerb.VIEW);
const RESIDENT_MANAGE = permissionKey(
  ModuleSlug.RESIDENTS,
  PermissionVerb.MANAGE
);

const RESIDENT_HANDLER_ROLES = [
  ...MANAGER_ROLES,
  MembershipRole.LINE_MANAGER,
];

const RESIDENT_READER_ROLES = [
  ...RESIDENT_HANDLER_ROLES,
  MembershipRole.STAFF,
];

const BRANCH_SCOPED_HANDLERS = [
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
  MembershipRole.STAFF,
];

const scopeBranchFilter = (standing, branchId) =>
  standing.role === MembershipRole.STAFF
    ? standing.branchId
    : scopeManagerBranch(standing, branchId);

/** Owner/SA anywhere in the org; SM and LM only on their own site. */
const assertMayAccessResidents = (standing, branchId) => {
  if (!RESIDENT_READER_ROLES.includes(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }

  if (BRANCH_SCOPED_HANDLERS.includes(standing.role)) {
    if (!branchId || String(standing.branchId) !== String(branchId)) {
      throw new AppError("outside_managed_branch", 403);
    }
  }
};

module.exports = {
  RESIDENT_VIEW,
  RESIDENT_MANAGE,
  RESIDENT_HANDLER_ROLES,
  RESIDENT_READER_ROLES,
  assertMayAccessResidents,
  actorStanding,
  assertBranchInOrganization,
  scopeBranchFilter,
};
