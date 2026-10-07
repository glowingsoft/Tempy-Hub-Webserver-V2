const { sendResponse } = require("@utils/responseUtil");
const { ALL_SURFACES } = require("@commonServices/auth/surfaceAccess");

/**
 * Optional gate for later: lock a route group to tokens minted for a portal.
 * Login already enforces surface; attach this only where a portal must stay closed.
 * Tokens issued before surface existed have req.surface null and are allowed through.
 */
const requireSurface = (allowed = []) => (req, res, next) => {
  const surfaces = Array.isArray(allowed) ? allowed : [allowed];
  if (!req.surface) return next();
  if (!surfaces.includes(req.surface)) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "role_not_allowed_for_surface",
    });
  }
  return next();
};

module.exports = { requireSurface, ALL_SURFACES };
