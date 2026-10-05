const { permissionKey, PermissionVerb } = require("@adminServices/organizations/permissionCatalogue");
const { ModuleSlug } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  MANAGER_ROLES,
} = require("@adminServices/staff/staffAccess");

const EVAC_VIEW = permissionKey(ModuleSlug.FIRE_DRILL_EVACUATION, PermissionVerb.VIEW);
const EVAC_MANAGE = permissionKey(ModuleSlug.FIRE_DRILL_EVACUATION, PermissionVerb.MANAGE);
const EVAC_APPROVE = permissionKey(ModuleSlug.FIRE_DRILL_EVACUATION, PermissionVerb.APPROVE);

module.exports = {
  EVAC_VIEW,
  EVAC_MANAGE,
  EVAC_APPROVE,
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  MANAGER_ROLES,
};
