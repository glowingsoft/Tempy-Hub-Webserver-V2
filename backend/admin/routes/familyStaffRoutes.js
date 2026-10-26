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
const { receivePhoto, receivePhotos } = require("@middlewares/familyPhotoMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const familyStaffController = require("../controllers/familyStaffController");

const router = express.Router();

const photoLimiter = createRateLimiter("family-post-photos", 15, 60);
const photoBatchLimiter = createRateLimiter("family-post-photo-batches", 15, 12);
const postLimiter = createRateLimiter("family-posts", 15, 60);
const newsletterSendLimiter = createRateLimiter("family-newsletter-sends", 15, 20);

// A fixed list for the form dropdowns: a signed-in user needs no organization, module or permission.
router.get("/relationships", auth, familyStaffController.listRelationships);

router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(FAMILY_STAFF_ROLES)
);

router.put("/members/:memberId", requirePermission(FAMILY_MANAGE), familyStaffController.updateMember);
router.put("/members/:memberId/access", requirePermission(FAMILY_MANAGE), familyStaffController.updateMemberAccess);

router.get("/residents/:residentId/members", requirePermission(FAMILY_VIEW), familyStaffController.listMembers);
router.delete("/residents/:residentId/members/:memberId", requirePermission(FAMILY_MANAGE), familyStaffController.removeMember);
router.put("/residents/:residentId/next-of-kin", requirePermission(FAMILY_MANAGE), familyStaffController.setNextOfKin);

router.get("/residents/:residentId/code", requirePermission(FAMILY_VIEW), familyStaffController.getCode);
router.post("/residents/:residentId/code", requirePermission(FAMILY_MANAGE), familyStaffController.createCode);

router.get("/join-requests", requirePermission(FAMILY_VIEW), familyStaffController.listJoinRequests);
router.put("/join-requests/:id", requirePermission(FAMILY_APPROVE), familyStaffController.updateJoinRequest);

router.put("/uploads/:id", requirePermission(FAMILY_APPROVE), familyStaffController.updateUpload);

router.get("/posts/taggable-residents", requirePermission(FAMILY_VIEW), familyStaffController.listTaggableResidents);
router.post("/posts/media/batch", photoBatchLimiter, requirePermission(FAMILY_MANAGE), receivePhotos, familyStaffController.uploadPostPhotos);
router.post("/posts/media", photoLimiter, requirePermission(FAMILY_MANAGE), receivePhoto, familyStaffController.uploadPostPhoto);
router.post("/posts", postLimiter, requirePermission(FAMILY_MANAGE), familyStaffController.createPost);
router.put("/posts/:id", requirePermission(FAMILY_MANAGE), familyStaffController.updatePost);
router.delete("/posts/:id", requirePermission(FAMILY_MANAGE), familyStaffController.removePost);
router.put("/posts/:id/reports", requirePermission(FAMILY_MANAGE), familyStaffController.updatePostReports);

router.post("/newsletters", requirePermission(FAMILY_MANAGE), familyStaffController.createNewsletter);
router.put("/newsletters/:id", requirePermission(FAMILY_MANAGE), familyStaffController.updateNewsletter);
router.put("/newsletters/:id/delivery", newsletterSendLimiter, requirePermission(FAMILY_MANAGE), familyStaffController.updateNewsletterDelivery);
router.delete("/newsletters/:id", requirePermission(FAMILY_MANAGE), familyStaffController.removeNewsletter);

router.get("/handovers", requirePermission(FAMILY_VIEW), familyStaffController.listHandovers);

module.exports = router;
