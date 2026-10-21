const { sendResponse } = require("@utils/responseUtil");
const {
  isFamilyModuleActive,
  listActiveLinks,
} = require("@appServices/family/familyAccessService");
const { isValidObjectId } = require("@appServices/family/familyPipeline");

// 404 rather than 403, so a resident's existence is not revealed.
const notFound = (res) =>
  sendResponse({ res, statusCode: 404, translationKey: "route_not_found" });

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
      if (!links.length) return notFound(res);

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
        if (!isValidObjectId(residentId)) return notFound(res);

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
  return notFound(res);
};

const requireNextOfKin = (req, res, next) => {
  if (!req.familyLink?.isNextOfKin) {
    return sendResponse({ res, statusCode: 403, translationKey: "next_of_kin_only" });
  }
  return next();
};

module.exports = { requireFamilyAccess, requireNextOfKin, requireFamilyModule };
