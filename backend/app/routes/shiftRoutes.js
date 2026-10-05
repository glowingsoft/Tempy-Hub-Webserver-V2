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

router.get("/my", shiftController.listMyShifts);
router.get("/open", shiftController.listOpenShifts);
router.get("/active", shiftController.getActiveShift);
router.post("/:shiftId/claims", shiftController.createClaim);

module.exports = router;
