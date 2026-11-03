const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const appraisalController = require("../controllers/appraisalController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL)
);

router.get("/", appraisalController.myAppraisal);
router.get("/:appraisalId", appraisalController.getAppraisal);
router.post("/:appraisalId/acknowledge", appraisalController.acknowledgeAppraisal);

module.exports = router;
