const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const createRateLimiter = require("@utils/rateLimiter");
const familySettingsController = require("../controllers/familySettingsController");

const router = express.Router();

const saveLimiter = createRateLimiter("family-settings", 15, 30);

const SITE_MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.use(auth, requireMembership(), requireFamilyModule, requireRoles(SITE_MANAGERS));

router.get("/", familySettingsController.getSettings);
router.put("/", saveLimiter, familySettingsController.updateSettings);

module.exports = router;
