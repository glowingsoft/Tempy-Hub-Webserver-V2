const mongoose = require("mongoose");
const { sendResponse } = require("@utils/responseUtil");
const { Membership } = require("@models/Membership");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const {
  MembershipRole,
  ActiveInactiveStatus,
  OrganizationStatus,
} = require("@models/domainEnums");

const toObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

/** Most to least privileged. Mirrors ROLE_RANK in membershipService. */
const ROLE_RANK = {
  [MembershipRole.SUPER_ADMIN]: 5,
  [MembershipRole.OWNER]: 4,
  [MembershipRole.SITE_MANAGER]: 3,
  [MembershipRole.LINE_MANAGER]: 2,
  [MembershipRole.STAFF]: 1,
};

const readScope = (req, key) =>
  req.params[key] || req.query[key] || req.header(`x-${key === "organizationId" ? "org" : "branch"}-id`);

/**
 * Resolves the caller's Membership for the requested org/branch scope.
 * Scope comes from a route param, a query param, or the x-org-id / x-branch-id headers.
 * Owners and superAdmins hold an org-wide membership (branchId null) and therefore
 * satisfy any branch scope inside their organization.
 */
const requireMembership = (options = {}) => {
  const { branchRequired = false } = options;

  return async (req, res, next) => {
    try {
      if (!req.user || !req.user._id) {
        return sendResponse({
          res,
          statusCode: 401,
          translationKey: "auth_token_missing",
        });
      }

      let organizationId = toObjectId(readScope(req, "organizationId"));
      const branchId = toObjectId(readScope(req, "branchId"));

      if (!organizationId && branchId) {
        const branch = await Branch.findById(branchId)
          .select("organizationId")
          .lean();
        if (branch?.organizationId) {
          organizationId = toObjectId(branch.organizationId);
        }
      }

      if (!organizationId) {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "organization_scope_required",
        });
      }

      if (branchRequired && !branchId) {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "branch_scope_required",
        });
      }

      const memberships = await Membership.find({
        userId: req.user._id,
        organizationId,
        status: ActiveInactiveStatus.ACTIVE,
      }).lean();

      // A platform admin operates above any single organization, so it acts with
      // an implicit org-wide superAdmin membership rather than a stored row.
      const isPlatformAdmin = req.user.userType === "admin";

      if (isPlatformAdmin && !memberships.length) {
        memberships.push({
          userId: req.user._id,
          organizationId,
          branchId: null,
          role: MembershipRole.SUPER_ADMIN,
          permissions: [],
          status: ActiveInactiveStatus.ACTIVE,
          isImplicit: true,
        });
      }

      if (!memberships.length) {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "no_membership_for_scope",
        });
      }

      // An org-wide membership outranks a branch one, so prefer it when both exist.
      const orgWide = memberships.find((m) => !m.branchId);
      const branchScoped = branchId
        ? memberships.find(
            (m) => m.branchId && String(m.branchId) === String(branchId)
          )
        : null;

      // With no branch in the request the question is only whether the caller
      // belongs to the organization, so a branch-scoped member (a site manager
      // on an org-level path) answers it with their strongest role.
      const strongest = !branchId
        ? memberships.reduce((a, b) => (ROLE_RANK[b.role] > ROLE_RANK[a.role] ? b : a))
        : null;

      const membership = orgWide || branchScoped || strongest;

      if (!membership || (branchId && !orgWide && !branchScoped)) {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "no_membership_for_scope",
        });
      }

      const organization = await Organization.findById(organizationId)
        .select("status moduleAccess name")
        .lean();

      if (!organization) {
        return sendResponse({
          res,
          statusCode: 404,
          translationKey: "organization_not_found",
        });
      }

      // A platform admin still needs in, to lift a suspension or to resend the
      // owner invitation that is holding an organization at pendingActivation.
      if (!isPlatformAdmin) {
        if (organization.status === OrganizationStatus.SUSPENDED) {
          return sendResponse({
            res,
            statusCode: 403,
            translationKey: "organization_suspended",
          });
        }

        if (organization.status === OrganizationStatus.PENDING_ACTIVATION) {
          return sendResponse({
            res,
            statusCode: 403,
            translationKey: "organization_pending_activation",
          });
        }
      }

      req.membership = membership;
      req.isPlatformAdmin = isPlatformAdmin;
      req.organization = organization;
      req.organizationId = organizationId;
      req.orgId = organizationId;
      req.branchId = branchId || membership.branchId || null;

      return next();
    } catch (error) {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "an_error",
        error,
      });
    }
  };
};

/** Requires requireMembership to have run first. */
const requireRoles = (allowedRoles = []) => (req, res, next) => {
  if (!req.membership) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "no_membership_for_scope",
    });
  }

  if (!allowedRoles.includes(req.membership.role)) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "insufficient_role",
    });
  }

  return next();
};

/** superAdmin and owner bypass granular permission checks. */
const requirePermission = (permission) => (req, res, next) => {
  if (!req.membership) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "no_membership_for_scope",
    });
  }

  const { role, permissions = [] } = req.membership;

  if (
    role === MembershipRole.SUPER_ADMIN ||
    role === MembershipRole.OWNER ||
    permissions.includes(permission)
  ) {
    return next();
  }

  return sendResponse({
    res,
    statusCode: 403,
    translationKey: "insufficient_permission",
  });
};

/** Gates sellable modules on what the organization has actually bought. */
const requireModule = (moduleSlug) => (req, res, next) => {
  if (!req.organization) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "no_membership_for_scope",
    });
  }
  console.log("moduleSlug", moduleSlug);

  // Module gating is commercial. Owners are still bound by what they bought;
  // only the platform operator sees everything.
  if (req.isPlatformAdmin) {
    return next();
  }

  const entry = (req.organization.moduleAccess || []).find(
    (m) => m.moduleSlug === moduleSlug
  );

  const active =
    entry &&
    entry.enabled &&
    (!entry.expiresAt || new Date(entry.expiresAt) > new Date());

  if (!active) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "module_not_enabled",
      values: { module: moduleSlug },
    });
  }

  return next();
};

/**
 * Line Manager gate. Reporting is driven by StaffProfile.reportsToStaffId,
 * not by job title, so a manager with no direct reports is refused.
 *
 * Prefer `hasReportsIf([MembershipRole.LINE_MANAGER])` on shared approve
 * routes so Owner / Site Manager are not forced through this check.
 */
const hasReports = async (req, res, next) => {
  try {
    if (!req.user || !req.user._id) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "auth_token_missing",
      });
    }

    // Reuse profile from an earlier gate on the same request.
    if (req.staffProfile?._id && req.directReportCount > 0) {
      return next();
    }

    const staffQuery = { userId: req.user._id };
    if (req.orgId) staffQuery.organizationId = req.orgId;

    const staff = await StaffProfile.findOne(staffQuery)
      .select("_id branchId organizationId")
      .lean();

    if (!staff) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "staff_profile_not_found",
      });
    }

    const reportCount = await StaffProfile.countDocuments({
      reportsToStaffId: staff._id,
    });

    if (!reportCount) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "no_direct_reports",
      });
    }

    req.staffProfile = staff;
    req.directReportCount = reportCount;

    return next();
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "an_error",
      error,
    });
  }
};

/**
 * Runs `hasReports` only when the caller's membership role is in `roles`.
 * Scalable for shared Owner/SM/LM routes without duplicating route trees.
 */
const hasReportsIf = (roles = [MembershipRole.LINE_MANAGER]) => (req, res, next) => {
  if (!roles.includes(req.membership?.role)) {
    return next();
  }
  return hasReports(req, res, next);
};

module.exports = {
  requireMembership,
  requireRoles,
  requirePermission,
  requireModule,
  hasReports,
  hasReportsIf,
};
