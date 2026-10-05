const jwt = require("jsonwebtoken");
const { sendResponse } = require("@utils/responseUtil");
const { Kiosk } = require("@models/Kiosk");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const {
  AuthAudience,
  KioskSetupStatus,
  BranchStatus,
  OrganizationStatus,
  ModuleSlug,
} = require("@models/domainEnums");

/** Kiosks authenticate as a device, not as a user, so they get their own token. */
const signKioskToken = (kiosk) =>
  jwt.sign(
    {
      kioskId: String(kiosk._id),
      branchId: String(kiosk.branchId),
      audience: AuthAudience.KIOSK,
    },
    process.env.JWT_SECRET
  );

const requireKioskSession = async (req, res, next) => {
  try {
    const token =
      req.header("x-kiosk-token") ||
      (req.header("Authorization") || "").replace("Bearer ", "");

    if (!token) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "kiosk_token_missing",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.audience !== AuthAudience.KIOSK) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "invalid_token",
      });
    }

    const kiosk = await Kiosk.findById(decoded.kioskId).lean();

    if (!kiosk) {
      return sendResponse({
        res,
        statusCode: 401,
        translationKey: "kiosk_not_found",
      });
    }

    if (kiosk.setupStatus !== KioskSetupStatus.REGISTERED) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "kiosk_not_registered",
      });
    }

    const branch = await Branch.findById(kiosk.branchId)
      .select("organizationId status name timezone settings")
      .lean();

    if (!branch || branch.status !== BranchStatus.ACTIVE) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "branch_not_active",
      });
    }

    req.kiosk = kiosk;
    req.branch = branch;
    req.branchId = kiosk.branchId;
    req.orgId = branch.organizationId;

    // Fire-and-forget so a heartbeat write never blocks a check-in.
    Kiosk.updateOne(
      { _id: kiosk._id },
      { $set: { lastHeartbeatAt: new Date() } }
    ).catch(() => {});

    return next();
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 401,
      translationKey: "invalid_token",
      error,
    });
  }
};

const isModuleEnabled = (organization, moduleSlug) => {
  const entry = (organization.moduleAccess || []).find(
    (m) => m.moduleSlug === moduleSlug
  );
  return (
    entry &&
    entry.enabled &&
    (!entry.expiresAt || new Date(entry.expiresAt) > new Date())
  );
};

/** Kiosk routes gate on org module access using branch.organizationId from the session. */
const requireKioskModule = (moduleSlug = ModuleSlug.SIGN_IN_ATTENDANCE) => {
  return async (req, res, next) => {
    try {
      if (!req.orgId) {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "organization_not_found",
        });
      }

      const organization = await Organization.findById(req.orgId)
        .select("moduleAccess status")
        .lean();

      if (!organization) {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "organization_not_found",
        });
      }

      if (organization.status !== OrganizationStatus.ACTIVE) {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "organization_suspended",
        });
      }

      if (!isModuleEnabled(organization, moduleSlug)) {
        return sendResponse({
          res,
          statusCode: 403,
          translationKey: "module_not_enabled",
          values: { module: moduleSlug },
        });
      }

      req.organization = organization;
      return next();
    } catch (error) {
      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "something_went_wrong",
        error,
      });
    }
  };
};

module.exports = { requireKioskSession, signKioskToken, requireKioskModule };
