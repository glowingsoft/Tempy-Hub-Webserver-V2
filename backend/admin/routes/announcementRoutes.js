const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole } = require("@models/domainEnums");
const createRateLimiter = require("@utils/rateLimiter");
const controller = require("../controllers/announcementController");

const router = express.Router();

const sendLimiter = createRateLimiter("announcement-sends", 15, 30);

router.use(
  auth,
  requireMembership(),
  requireRoles([
    MembershipRole.SUPER_ADMIN,
    MembershipRole.OWNER,
    MembershipRole.SITE_MANAGER,
  ]),
);

router.get("/", controller.listAnnouncements);
router.post("/", sendLimiter, controller.createAnnouncement);
router.post(
  "/:announcementId/remind",
  sendLimiter,
  controller.remindAnnouncement,
);

module.exports = router;
