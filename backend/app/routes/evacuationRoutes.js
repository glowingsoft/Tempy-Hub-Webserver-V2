const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const evacuationController = require("../controllers/evacuationController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION)
);

router.get("/active", evacuationController.getActiveEvacuation);
router.post("/me/check", evacuationController.markMyself);

module.exports = router;
