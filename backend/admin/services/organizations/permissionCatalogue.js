const { ModuleSlug, MembershipRole } = require("@models/domainEnums");

/**
 * Closed vocabulary for `Membership.permissions`.
 *
 * Permissions are the per-person exception on top of a role, not a replacement
 * for it: a line manager who may additionally approve leave, a carer who may
 * countersign documents. The role still decides the shape of someone's access.
 *
 * Every module carries the same three verbs. A uniform set is predictable for
 * the admin panel to render and for us to reason about, at the cost of a few
 * combinations that will never be used (approving a floor plan, say). Those are
 * harmless while unused, and cheap to hide later.
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

/** Every valid permission, in module order. */
const CATALOGUE = Object.values(ModuleSlug).flatMap((moduleSlug) =>
  Object.values(PermissionVerb).map((verb) => ({
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
 */
const ROLES_WITH_ALL_PERMISSIONS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
];

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

/** Platform operator menu — every sellable module, all verbs. */
const platformAdminModuleMenu = (moduleNameBySlug = new Map()) =>
  Object.values(ModuleSlug).map((moduleSlug) => ({
    moduleSlug,
    moduleName: moduleNameBySlug.get(moduleSlug) || moduleSlug,
    permissions: Object.values(PermissionVerb),
  }));

module.exports = {
  PermissionVerb,
  CATALOGUE,
  getPermission,
  isKnownPermission,
  permissionKey,
  enabledModuleSlugs,
  ROLES_WITH_ALL_PERMISSIONS,
  effectivePermissions,
  modulesForMenu,
  platformAdminModuleMenu,
};
