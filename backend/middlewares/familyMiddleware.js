const mongoose = require("mongoose");
const { sendResponse } = require("@utils/responseUtil");
const {
  listActiveLinks,
} = require("@appServices/family/familyAccessService");

/**
 * Anything the caller may not see is reported as not found, never forbidden, so
 * the existence of a resident, post or upload is not revealed.
 */
const notFound = (res) =>
  sendResponse({ res, statusCode: 404, translationKey: "route_not_found" });

/**
 * Gate for family-app routes that act on a resident. Run it after `auth` and
 * `requireAudience([AuthAudience.FAMILY])`.
 *
 * The caller's links are read from the database on every request rather than
 * trusted from the token, so removing a member, or switching Family Engagement
 * off, cuts access on the very next call. With no usable link the answer is 404.
 *
 * Pass `{ param: "residentId" }` to also require a link to the resident named in
 * that route parameter. Use `{ param: "residentId", in: "query" }` (or "body") when
 * the id is not part of the path; a missing id is then a 400. Sets
 * `req.familyLinks` and, when a param is given, `req.familyLink`.
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

/** Requires `requireFamilyAccess({ param })` to have run first. */
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
