const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { requireFamilyModule } = require("@middlewares/familyMiddleware");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_APPROVE,
  FAMILY_STAFF_ROLES,
} = require("@adminServices/family/familyAccess");
const familyStaffController = require("../controllers/familyStaffController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(FAMILY_STAFF_ROLES)
);

router.get("/residents/:residentId/members", requirePermission(FAMILY_VIEW), familyStaffController.listMembers);
router.delete("/residents/:residentId/members/:memberId", requirePermission(FAMILY_MANAGE), familyStaffController.removeMember);
router.put("/residents/:residentId/next-of-kin", requirePermission(FAMILY_MANAGE), familyStaffController.setNextOfKin);

router.get("/residents/:residentId/code", requirePermission(FAMILY_VIEW), familyStaffController.getCode);
router.post("/residents/:residentId/code", requirePermission(FAMILY_MANAGE), familyStaffController.createCode);

router.get("/join-requests", requirePermission(FAMILY_VIEW), familyStaffController.listJoinRequests);
router.put("/join-requests/:id", requirePermission(FAMILY_APPROVE), familyStaffController.updateJoinRequest);

router.put("/uploads/:id", requirePermission(FAMILY_APPROVE), familyStaffController.updateUpload);

router.get("/handovers", requirePermission(FAMILY_VIEW), familyStaffController.listHandovers);

module.exports = router;
