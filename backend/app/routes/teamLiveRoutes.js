const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { TEAM_APPROVER_ROLES } = require("@adminServices/staff/staffAccess");
const {
  getTeamLive,
  getTeamLiveActivity,
  getTeamRota,
} = require("../controllers/teamLiveController");

const router = express.Router();

router.use(auth, requireMembership(), requireRoles(TEAM_APPROVER_ROLES));

router.get("/activity", getTeamLiveActivity);
router.get("/rota", getTeamRota);
router.get("/", getTeamLive);

module.exports = router;
