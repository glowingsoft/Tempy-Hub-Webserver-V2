const { AppError } = require("@services/_errors/AppError");
const {
  AppSurface,
  AuthAudience,
  MembershipRole,
  MembershipRoleRank,
} = require("@models/domainEnums");

/**
 * Minimum membership rank to enter each portal.
 * Rank is inclusive: owner (4) may open managerApp (min 2); staff (1) may not.
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
};

const ALL_SURFACES = Object.values(AppSurface);

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

  if (access?.isPlatformAdmin) return;

  if (rule.minRank == null) return;

  const rank = MembershipRoleRank[access?.highestRole] || 0;
  if (rank < rule.minRank) {
    throw new AppError("role_not_allowed_for_surface", 403);
  }
};

module.exports = {
  SURFACE_RULES,
  ALL_SURFACES,
  assertSurfaceAccess,
};
