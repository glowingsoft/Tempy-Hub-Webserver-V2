const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const { listKiosks } = require("../controllers/kioskScreenController");

const router = express.Router();

router.get(
  "/",
  auth,
  requireMembership(),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requireRoles(MANAGER_ROLES),
  listKiosks,
);

module.exports = router;
