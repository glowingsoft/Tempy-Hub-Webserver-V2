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
  duplicateKey,
} = require("@adminServices/staff/staffAccess");

const PEEP_VIEW = permissionKey(
  ModuleSlug.PEEP_FLOOR_PLAN,
  PermissionVerb.VIEW
);
const PEEP_MANAGE = permissionKey(
  ModuleSlug.PEEP_FLOOR_PLAN,
  PermissionVerb.MANAGE
);

module.exports = {
  PEEP_VIEW,
  PEEP_MANAGE,
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  duplicateKey,
};
