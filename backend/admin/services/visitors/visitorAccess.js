const {
  permissionKey,
  PermissionVerb,
} = require("@adminServices/organizations/permissionCatalogue");
const { ModuleSlug } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  MANAGER_ROLES,
} = require("@adminServices/staff/staffAccess");

/** Visitor/contractor seed + presence for fire-drill on-site counts (Figma Screen 86). */
const MODULE = ModuleSlug.FIRE_DRILL_EVACUATION;

const VISIT_VIEW = permissionKey(MODULE, PermissionVerb.VIEW);
const VISIT_MANAGE = permissionKey(MODULE, PermissionVerb.MANAGE);

module.exports = {
  VISIT_VIEW,
  VISIT_MANAGE,
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  MANAGER_ROLES,
};
