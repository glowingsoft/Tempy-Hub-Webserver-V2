const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const requirementController = require("../controllers/requirementController");
const { TEAM_APPROVER_ROLES } = require("@adminServices/staff/staffAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requireRoles(TEAM_APPROVER_ROLES)
);

router.get("/:assignmentId", requirementController.getAssignment);
router.patch("/:assignmentId", requirementController.updateAssignment);
router.delete("/:assignmentId", requirementController.deleteAssignment);
router.post("/:assignmentId/records", requirementController.createRecord);

module.exports = router;
