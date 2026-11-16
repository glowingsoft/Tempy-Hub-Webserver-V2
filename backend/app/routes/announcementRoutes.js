const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership } = require("@middlewares/membershipMiddleware");
const controller = require("../controllers/announcementController");

const router = express.Router();

router.use(auth, requireMembership());

router.get("/mine", controller.listMine);
router.get("/mine/:announcementId", controller.getMine);
router.post(
  "/mine/:announcementId/acknowledge",
  controller.acknowledgeAnnouncement,
);

module.exports = router;
