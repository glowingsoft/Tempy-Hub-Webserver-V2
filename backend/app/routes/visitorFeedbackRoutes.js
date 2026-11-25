const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const controller = require("../controllers/visitorFeedbackController");

const router = express.Router();

router.use(auth, requireMembership(), requireRoles(MANAGER_ROLES));

router.get("/", controller.getScreen);
router.put("/settings", controller.saveSettings);

module.exports = router;
