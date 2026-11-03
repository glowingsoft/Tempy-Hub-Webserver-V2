const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const supervisionController = require("../controllers/supervisionController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL)
);

router.get("/", supervisionController.mySupervision);
router.get("/:supervisionId", supervisionController.getSupervision);

module.exports = router;
