const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const {
  requireFamilyModule,
  checkFamilyFilters,
} = require("@middlewares/familyMiddleware");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_APPROVE,
  FAMILY_STAFF_ROLES,
} = require("@adminServices/family/familyAccess");
const createRateLimiter = require("@utils/rateLimiter");
const familyVisitManagerController = require("../controllers/familyVisitManagerController");

const router = express.Router();

const decideLimiter = createRateLimiter("family-visit-decisions", 15, 120);
const pauseLimiter = createRateLimiter("family-visit-pauses", 15, 20);

// The Visit Requests screen of the site manager and line manager apps.
router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(FAMILY_STAFF_ROLES),
  checkFamilyFilters,
);

router.get("/", requirePermission(FAMILY_VIEW), familyVisitManagerController.listRequests);
router.put("/visiting", pauseLimiter, requirePermission(FAMILY_MANAGE), familyVisitManagerController.updateVisiting);
router.put("/:id", decideLimiter, requirePermission(FAMILY_APPROVE), familyVisitManagerController.updateRequest);

module.exports = router;
