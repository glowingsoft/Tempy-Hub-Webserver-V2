const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
} = require("@middlewares/membershipMiddleware");
const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const { getRota } = require("../controllers/rotaScreenController");

const router = express.Router();

router.get("/", auth, requireMembership(), requireRoles(MANAGER_ROLES), getRota);

module.exports = router;
