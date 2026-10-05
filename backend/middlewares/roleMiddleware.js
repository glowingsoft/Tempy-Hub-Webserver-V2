// middlewares/roleMiddleware.js
const { sendResponse } = require("@utils/responseUtil");

const roleMiddleware = (allowedRoles) => (req, res, next) => {
  if (allowedRoles.includes(req.user.userType)) {
    next();
  } else {
    sendResponse({
      res,
      statusCode: 403,
      translationKey: `Access denied. ${allowedRoles.join(" or ")} only.`,
      error: `Access denied. ${allowedRoles.join(" or ")} only.`,
    });
  }
};

module.exports = roleMiddleware;

// Checks users.accountState.userType ("user" | "admin" | "guest") — the platform
// axis, NOT the Tempy domain role. For organization-scoped role checks use
// requireRoles from membershipMiddleware, which reads Membership.role.
//e.g usage app.use("/shared-route", roleMiddleware(["admin"]), (req, res) => {
