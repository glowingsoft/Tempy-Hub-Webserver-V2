const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const shiftController = require("../controllers/shiftController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.ROTA_SCHEDULING)
);

router.post("/:claimId/withdraw", shiftController.withdrawClaim);

module.exports = router;
