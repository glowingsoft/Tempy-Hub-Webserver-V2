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
} = require("@adminServices/staff/staffAccess");

const DOCUMENTS_VIEW = permissionKey(
  ModuleSlug.DOCUMENTS_ESIGN,
  PermissionVerb.VIEW
);
const DOCUMENTS_MANAGE = permissionKey(
  ModuleSlug.DOCUMENTS_ESIGN,
  PermissionVerb.MANAGE
);

module.exports = {
  DOCUMENTS_VIEW,
  DOCUMENTS_MANAGE,
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
};
