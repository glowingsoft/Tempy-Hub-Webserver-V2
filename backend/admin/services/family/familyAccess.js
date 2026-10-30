const {
  permissionKey,
  PermissionVerb,
} = require("@adminServices/organizations/permissionCatalogue");
const { ModuleSlug } = require("@models/domainEnums");
const {
  RESIDENT_HANDLER_ROLES,
} = require("@adminServices/residents/residentAccess");

const MODULE = ModuleSlug.FAMILY_ENGAGEMENT;

/** Read family data: members, requests, codes, handovers. */
const FAMILY_VIEW = permissionKey(MODULE, PermissionVerb.VIEW);

/** Change a family: invite, remove, set the next of kin, make a code. */
const FAMILY_MANAGE = permissionKey(MODULE, PermissionVerb.MANAGE);

/** Decide join requests. Kept apart from manage so approval can be granted on its own. */
const FAMILY_APPROVE = permissionKey(MODULE, PermissionVerb.APPROVE);

/** Roles that may reach the staff family routes at all; the permission above then decides what they can do. */
const FAMILY_STAFF_ROLES = RESIDENT_HANDLER_ROLES;

module.exports = {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_APPROVE,
  FAMILY_STAFF_ROLES,
};
