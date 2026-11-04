const { AppError } = require("@services/_errors/AppError");
const {
  AppSurface,
  AuthAudience,
  MembershipRole,
  MembershipRoleRank,
} = require("@models/domainEnums");

/**
 * Membership rank window for each portal.
 * managerApp is site/line managers only — owner must use ownerAdmin.
 * platformAdmin is not rank-based — only accountState.userType === "admin".
 */
const SURFACE_RULES = {
  [AppSurface.STAFF_APP]: {
    audience: AuthAudience.STAFF,
    minRank: MembershipRoleRank[MembershipRole.STAFF],
  },
  [AppSurface.MANAGER_APP]: {
    audience: AuthAudience.STAFF,
    minRank: MembershipRoleRank[MembershipRole.LINE_MANAGER],
    maxRank: MembershipRoleRank[MembershipRole.SITE_MANAGER],
  },
  [AppSurface.OWNER_ADMIN]: {
    audience: AuthAudience.STAFF,
    minRank: MembershipRoleRank[MembershipRole.OWNER],
  },
  [AppSurface.PLATFORM_ADMIN]: {
    audience: AuthAudience.STAFF,
    platformOnly: true,
  },
  [AppSurface.RESIDENT_APP]: { audience: AuthAudience.RESIDENT },
  [AppSurface.VISITOR_APP]: { audience: AuthAudience.VISITOR },
  [AppSurface.FAMILY_APP]: { audience: AuthAudience.FAMILY },
};

const ALL_SURFACES = Object.values(AppSurface);

const normalizeSurface = (value) => {
  if (value == null || String(value).trim() === "") return undefined;
  const wanted = String(value).trim().toLowerCase();
  const match = ALL_SURFACES.find((surface) => surface.toLowerCase() === wanted);
  if (!match) throw new AppError("invalid_app_surface", 400);
  return match;
};

/** Portal for this account when the client does not send `surface`. */
const surfaceFromAccess = ({ audience, access }) => {
  if (audience === AuthAudience.FAMILY) return AppSurface.FAMILY_APP;
  if (audience === AuthAudience.RESIDENT) return AppSurface.RESIDENT_APP;
  if (audience === AuthAudience.VISITOR) return AppSurface.VISITOR_APP;
  if (audience !== AuthAudience.STAFF) return undefined;

  if (access?.isPlatformAdmin) return AppSurface.PLATFORM_ADMIN;

  const role = access?.highestRole;
  if (role === MembershipRole.OWNER || role === MembershipRole.SUPER_ADMIN) {
    return AppSurface.OWNER_ADMIN;
  }
  if (
    role === MembershipRole.SITE_MANAGER ||
    role === MembershipRole.LINE_MANAGER
  ) {
    return AppSurface.MANAGER_APP;
  }
  if (role === MembershipRole.STAFF) return AppSurface.STAFF_APP;

  throw new AppError("no_membership_for_scope", 403);
};

const assertSurfaceAccess = ({ surface, audience, access }) => {
  if (!surface) return;

  const rule = SURFACE_RULES[surface];
  if (!rule) throw new AppError("invalid_app_surface", 400);

  if (rule.audience !== audience) {
    throw new AppError("role_not_allowed_for_surface", 403);
  }

  if (rule.platformOnly) {
    if (!access?.isPlatformAdmin) {
      throw new AppError("role_not_allowed_for_surface", 403);
    }
    return;
  }

  if (rule.minRank == null) return;

  const rank = MembershipRoleRank[access?.highestRole] || 0;
  if (rank < rule.minRank) {
    throw new AppError("role_not_allowed_for_surface", 403);
  }
  if (rule.maxRank != null && rank > rule.maxRank) {
    throw new AppError("role_not_allowed_for_surface", 403);
  }
};

module.exports = {
  SURFACE_RULES,
  ALL_SURFACES,
  normalizeSurface,
  surfaceFromAccess,
  assertSurfaceAccess,
};
