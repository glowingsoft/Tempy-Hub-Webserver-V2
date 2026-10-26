const { sendResponse } = require("@utils/responseUtil");
const {
  isFamilyModuleActive,
  listActiveLinks,
} = require("@appServices/family/familyAccessService");
const { isValidObjectId, toObjectId } = require("@appServices/family/familyPipeline");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { AppError } = require("@services/_errors/AppError");
const { queryId } = require("../helperUtils/familyQuery");

// 404 rather than 403, so a resident's existence is not revealed: a resident that does not exist
// and one the caller is not linked to answer the same.
const notFound = (res, translationKey = "resident_not_found") =>
  sendResponse({ res, statusCode: 404, translationKey });

const readResidentId = (req, { param, from = "params" }) => (req[from] || {})[param];

/**
 * Reads the caller's links live on every request, so a removed member or a module
 * switched off loses access at once. Pass { param, from } to also require a link to
 * the resident named in that request part (from: "params" by default, or "query" / "body").
 */
const requireFamilyAccess =
  (options = {}) =>
  async (req, res, next) => {
    try {
      const links = await listActiveLinks(req.user._id);
      if (!links.length) return notFound(res, "family_profile_not_found");

      let link = null;
      if (options.param) {
        const residentId = readResidentId(req, options);

        if (options.from && options.from !== "params" && !residentId) {
          return sendResponse({
            res,
            statusCode: 400,
            translationKey: "resident_id_required",
          });
        }
        if (!isValidObjectId(residentId)) {
          return sendResponse({ res, statusCode: 400, translationKey: "invalid_resident_id" });
        }

        link = links.find((l) => String(l.residentId) === String(residentId));
        if (!link) return notFound(res);
      }

      req.familyLinks = links;
      req.familyLink = link;
      return next();
    } catch (error) {
      return sendResponse({ res, statusCode: 500, translationKey: "an_error", error });
    }
  };

/**
 * Staff routes: with Family Engagement off the customer sees nothing, so the answer
 * is 404 (not the 403 of requireModule). A platform admin passes, as with every module.
 * Run it after requireMembership.
 */
const requireFamilyModule = (req, res, next) => {
  if (!req.organization) {
    return sendResponse({ res, statusCode: 403, translationKey: "no_membership_for_scope" });
  }
  if (req.isPlatformAdmin || isFamilyModuleActive(req.organization)) return next();
  return notFound(res, "family_module_not_enabled");
};

const requireNextOfKin = (req, res, next) => {
  if (!req.familyLink?.isNextOfKin) {
    return sendResponse({ res, statusCode: 403, translationKey: "next_of_kin_only" });
  }
  return next();
};

/**
 * Org-path lists take optional branchId and residentId filters. A malformed id is a 400 that names
 * the field, and an id outside this organization is a 404 that names what is missing, rather than
 * a list that is silently empty. Run it after requireMembership.
 */
const checkFamilyFilters = async (req, res, next) => {
  try {
    const branchId = queryId(req.query.branchId, "branchId");
    const residentId = queryId(req.query.residentId, "residentId");
    if (!branchId && !residentId) return next();
    const organizationId = toObjectId(req.orgId);

    const [branch, resident] = await Promise.all([
      branchId ? Branch.exists({ _id: toObjectId(branchId), organizationId }) : true,
      residentId ? Resident.exists({ _id: toObjectId(residentId), organizationId }) : true,
    ]);
    if (!branch) throw new AppError("branch_not_found", 404);
    if (!resident) throw new AppError("resident_not_found", 404);
    return next();
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { requireFamilyAccess, requireNextOfKin, requireFamilyModule, checkFamilyFilters };
