const { permissionKey, PermissionVerb } = require("@adminServices/organizations/permissionCatalogue");
const { ModuleSlug } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertMayApproveForStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  TEAM_APPROVER_ROLES,
  applyLineManagerStaffScope,
  resolveScopedStaffIds,
  resolveSubordinates,
} = require("@adminServices/staff/staffAccess");

const ATTENDANCE_VIEW = permissionKey(
  ModuleSlug.SIGN_IN_ATTENDANCE,
  PermissionVerb.VIEW
);
const ATTENDANCE_MANAGE = permissionKey(
  ModuleSlug.SIGN_IN_ATTENDANCE,
  PermissionVerb.MANAGE
);
const ATTENDANCE_APPROVE = permissionKey(
  ModuleSlug.SIGN_IN_ATTENDANCE,
  PermissionVerb.APPROVE
);

module.exports = {
  ATTENDANCE_VIEW,
  ATTENDANCE_MANAGE,
  ATTENDANCE_APPROVE,
  TEAM_APPROVER_ROLES,
  actorStanding,
  assertMayManageStaff,
  assertMayApproveForStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  applyLineManagerStaffScope,
  resolveScopedStaffIds,
  resolveSubordinates,
};
