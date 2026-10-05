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

const LEAVE_VIEW = permissionKey(ModuleSlug.LEAVE, PermissionVerb.VIEW);
const LEAVE_MANAGE = permissionKey(ModuleSlug.LEAVE, PermissionVerb.MANAGE);
const LEAVE_APPROVE = permissionKey(ModuleSlug.LEAVE, PermissionVerb.APPROVE);

module.exports = {
  LEAVE_VIEW,
  LEAVE_MANAGE,
  LEAVE_APPROVE,
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
