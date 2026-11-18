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

const asManager = requireRoles([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
]);

router.use(auth, requireMembership());

router.get("/mine", controller.listMine);
router.get("/mine/:announcementId", controller.getMine);

router.get("/", asManager, controller.listAnnouncements);
router.post("/", sendLimiter, asManager, controller.createAnnouncement);
router.get("/:announcementId", asManager, controller.getAnnouncement);
router.post(
  "/:announcementId/remind",
  sendLimiter,
  asManager,
  controller.remindAnnouncement,
);

module.exports = router;
