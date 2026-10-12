const { permissionKey, PermissionVerb } = require("@adminServices/organizations/permissionCatalogue");
const { ModuleSlug } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  applyLineManagerStaffScope,
} = require("@adminServices/staff/staffAccess");

const ROTA_VIEW = permissionKey(ModuleSlug.ROTA_SCHEDULING, PermissionVerb.VIEW);
const ROTA_MANAGE = permissionKey(ModuleSlug.ROTA_SCHEDULING, PermissionVerb.MANAGE);
const ROTA_APPROVE = permissionKey(ModuleSlug.ROTA_SCHEDULING, PermissionVerb.APPROVE);

module.exports = {
  ROTA_VIEW,
  ROTA_MANAGE,
  ROTA_APPROVE,
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  applyLineManagerStaffScope,
};
