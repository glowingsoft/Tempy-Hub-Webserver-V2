const { sendResponse } = require("@utils/responseUtil");

/**
 * Login is shared across surfaces, so each route group asserts the audience
 * its token was issued for. This stops a resident token reaching staff APIs.
 */
const requireAudience = (allowed = []) => (req, res, next) => {
  const audiences = Array.isArray(allowed) ? allowed : [allowed];

  if (!req.audience || !audiences.includes(req.audience)) {
    return sendResponse({
      res,
      statusCode: 403,
      translationKey: "wrong_token_audience",
    });
  }

  return next();
};

module.exports = { requireAudience };
