const { ModuleSlug, MembershipRole } = require("@models/domainEnums");

/**
 * Closed vocabulary for `Membership.permissions`.
 *
 * Permissions are the per-person exception on top of a role, not a replacement
 * for it: a line manager who may additionally approve leave, a carer who may
 * countersign documents. The role still decides the shape of someone's access.
 *
 * View and manage exist on every module. Approve exists only where a route
 * actually signs something off (leave, attendance changes, rota claims, family
 * requests, document countersign).
 */
const PermissionVerb = {
  VIEW: "view",
  MANAGE: "manage",
  APPROVE: "approve",
};

const VERB_LABEL = {
  [PermissionVerb.VIEW]: "View",
  [PermissionVerb.MANAGE]: "Manage",
  [PermissionVerb.APPROVE]: "Approve",
};

/**
 * Lowest role allowed to hand each verb out. Viewing is routine enough for a
 * line manager to delegate; changing or approving is a site manager's call.
 */
const VERB_MIN_GRANT_ROLE = {
  [PermissionVerb.VIEW]: MembershipRole.LINE_MANAGER,
  [PermissionVerb.MANAGE]: MembershipRole.SITE_MANAGER,
  [PermissionVerb.APPROVE]: MembershipRole.SITE_MANAGER,
};

const permissionKey = (moduleSlug, verb) => `${moduleSlug}.${verb}`;

const MODULES_WITH_APPROVE = new Set([
  ModuleSlug.LEAVE,
  ModuleSlug.SIGN_IN_ATTENDANCE,
  ModuleSlug.ROTA_SCHEDULING,
  ModuleSlug.FAMILY_ENGAGEMENT,
  ModuleSlug.DOCUMENTS_ESIGN,
]);

const verbsForModule = (moduleSlug) => {
  const verbs = [PermissionVerb.VIEW, PermissionVerb.MANAGE];
  if (MODULES_WITH_APPROVE.has(moduleSlug)) verbs.push(PermissionVerb.APPROVE);
  return verbs;
};

/** Every valid permission, in module order. */
const CATALOGUE = Object.values(ModuleSlug).flatMap((moduleSlug) =>
  verbsForModule(moduleSlug).map((verb) => ({
    key: permissionKey(moduleSlug, verb),
    moduleSlug,
    verb,
    verbLabel: VERB_LABEL[verb],
    minGrantRole: VERB_MIN_GRANT_ROLE[verb],
  }))
);

const BY_KEY = new Map(CATALOGUE.map((entry) => [entry.key, entry]));

const getPermission = (key) => BY_KEY.get(key) || null;

const isKnownPermission = (key) => BY_KEY.has(key);

/** Slugs the organization has actually bought and not let lapse. */
const enabledModuleSlugs = (organization) =>
  new Set(
    (organization?.moduleAccess || [])
      .filter(
        (entry) =>
          entry.enabled &&
          (!entry.expiresAt || new Date(entry.expiresAt) > new Date())
      )
      .map((entry) => entry.moduleSlug)
  );

/**
 * Roles that answer every permission check by virtue of the role itself, so
 * their stored `Membership.permissions` is always empty. See requirePermission.
 * Site Manager runs one site; branch scope is enforced in services, not here.
 */
const ROLES_WITH_ALL_PERMISSIONS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

/** Staff and line managers always receive these unless the module is not bought. */
const DEFAULT_STAFF_PERMISSION_KEYS = [
  permissionKey(ModuleSlug.DOCUMENTS_ESIGN, PermissionVerb.VIEW),
  permissionKey(ModuleSlug.DOCUMENTS_ESIGN, PermissionVerb.APPROVE),
];

const withDefaultStaffPermissions = (role, organization, permissions) => {
  if (ROLES_WITH_ALL_PERMISSIONS.includes(role)) return [];

  const merged = new Set(Array.isArray(permissions) ? permissions : []);
  if (
    role !== MembershipRole.STAFF &&
    role !== MembershipRole.LINE_MANAGER
  ) {
    return [...merged];
  }

  const enabled = enabledModuleSlugs(organization);
  for (const key of DEFAULT_STAFF_PERMISSION_KEYS) {
    const entry = getPermission(key);
    if (entry && enabled.has(entry.moduleSlug)) merged.add(key);
  }
  return [...merged];
};

/**
 * What a membership may actually do, as opposed to the exceptions stored on it.
 *
 * Derived on read rather than written to the owner's row at activation: module
 * access is bought and allowed to lapse over the life of an organization, and a
 * stored list would quietly drift out of step with it.
 */
const effectivePermissions = (membership, organization) => {
  const enabled = enabledModuleSlugs(organization);

  if (ROLES_WITH_ALL_PERMISSIONS.includes(membership?.role)) {
    return CATALOGUE.filter((entry) => enabled.has(entry.moduleSlug)).map(
      (entry) => entry.key
    );
  }

  return (membership?.permissions || []).filter((key) => {
    const entry = getPermission(key);
    return entry && enabled.has(entry.moduleSlug);
  });
};

/**
 * Groups effective permission keys by module for menu rendering.
 *
 * Only modules the organization has bought appear, and only verbs the person
 * actually holds within each module.
 */
const modulesForMenu = (permissionKeys, moduleNameBySlug = new Map()) => {
  const byModule = new Map();

  for (const key of permissionKeys) {
    const entry = getPermission(key);
    if (!entry) continue;

    if (!byModule.has(entry.moduleSlug)) {
      byModule.set(entry.moduleSlug, {
        moduleSlug: entry.moduleSlug,
        moduleName: moduleNameBySlug.get(entry.moduleSlug) || entry.moduleSlug,
        permissions: [],
      });
    }

    const bucket = byModule.get(entry.moduleSlug);
    if (!bucket.permissions.includes(entry.verb)) {
      bucket.permissions.push(entry.verb);
    }
  }

  return [...byModule.values()].sort((a, b) =>
    a.moduleSlug.localeCompare(b.moduleSlug)
  );
};

/** Platform operator menu — sellable modules with only verbs that exist. */
const platformAdminModuleMenu = (moduleNameBySlug = new Map()) =>
  Object.values(ModuleSlug).map((moduleSlug) => ({
    moduleSlug,
    moduleName: moduleNameBySlug.get(moduleSlug) || moduleSlug,
    permissions: verbsForModule(moduleSlug),
  }));

module.exports = {
  PermissionVerb,
  MODULES_WITH_APPROVE,
  CATALOGUE,
  getPermission,
  isKnownPermission,
  permissionKey,
  enabledModuleSlugs,
  ROLES_WITH_ALL_PERMISSIONS,
  DEFAULT_STAFF_PERMISSION_KEYS,
  withDefaultStaffPermissions,
  effectivePermissions,
  modulesForMenu,
  platformAdminModuleMenu,
};
