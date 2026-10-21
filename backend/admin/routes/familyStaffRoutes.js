const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const { RESIDENT_HANDLER_ROLES } = require("@adminServices/residents/residentAccess");
const familyStaffController = require("../controllers/familyStaffController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.FAMILY_ENGAGEMENT),
  requireRoles(RESIDENT_HANDLER_ROLES)
);

router.get("/residents/:residentId/members", familyStaffController.listMembers);
router.delete("/residents/:residentId/members/:memberId", familyStaffController.removeMember);
router.put("/residents/:residentId/next-of-kin", familyStaffController.setNextOfKin);

router.get("/residents/:residentId/code", familyStaffController.getCode);
router.post("/residents/:residentId/code", familyStaffController.createCode);

router.get("/join-requests", familyStaffController.listJoinRequests);
router.post("/join-requests/:id/approve", familyStaffController.approveJoinRequest);
router.post("/join-requests/:id/reject", familyStaffController.rejectJoinRequest);

router.get("/handovers", familyStaffController.listHandovers);

module.exports = router;
