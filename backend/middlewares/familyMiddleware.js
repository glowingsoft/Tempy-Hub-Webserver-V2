const mongoose = require("mongoose");
const { sendResponse } = require("@utils/responseUtil");
const {
  listActiveLinks,
} = require("@appServices/family/familyAccessService");

// 404 rather than 403, so a resident's existence is not revealed.
const notFound = (res) =>
  sendResponse({ res, statusCode: 404, translationKey: "route_not_found" });

/**
 * Reads the caller's links live on every request, so a removed member or a module
 * switched off loses access at once. Pass { param, in } to require a link to a
 * specific resident (in: "params" by default, or "query" / "body").
 */
const requireFamilyAccess =
  (options = {}) =>
  async (req, res, next) => {
    try {
      const links = await listActiveLinks(req.user._id);
      if (!links.length) return notFound(res);

      let link = null;
      if (options.param) {
        const source = options.in || "params";
        const residentId = (req[source] || {})[options.param];

        if (source !== "params" && !residentId) {
          return sendResponse({
            res,
            statusCode: 400,
            translationKey: "resident_id_required",
          });
        }
        if (!mongoose.Types.ObjectId.isValid(residentId)) return notFound(res);

        link = links.find((l) => String(l.residentId) === String(residentId));
        if (!link) return notFound(res);
      }

      req.familyLinks = links;
      req.familyLink = link;
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

const requireNextOfKin = (req, res, next) => {
  if (!req.familyLink?.isNextOfKin) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "next_of_kin_only",
    });
  }
  return next();
};

module.exports = { requireFamilyAccess, requireNextOfKin };
