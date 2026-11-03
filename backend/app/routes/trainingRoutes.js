const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const requirementListController = require("../controllers/requirementListController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL)
);

router.get("/", requirementListController.myTraining);

module.exports = router;
