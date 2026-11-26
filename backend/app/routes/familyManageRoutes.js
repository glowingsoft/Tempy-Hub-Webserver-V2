const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const {
  requireFamilyModule,
  scopeToOwnBranch,
  checkFamilyFilters,
} = require("@middlewares/familyMiddleware");
const {
  receivePhoto,
  receivePhotos,
} = require("@middlewares/familyPhotoMiddleware");
const { MANAGER_ROLES } = require("@adminServices/staff/staffAccess");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
} = require("@adminServices/family/familyAccess");
const createRateLimiter = require("@utils/rateLimiter");
const controller = require("../controllers/familyManageController");
const staffController = require("../../admin/controllers/familyStaffController");
const invitationController = require("../../admin/controllers/familyInvitationController");

const messageLimiter = createRateLimiter("family-manage-messages", 15, 20);

const router = express.Router();

const photoLimiter = createRateLimiter("family-manage-photos", 15, 60);
const photoBatchLimiter = createRateLimiter(
  "family-manage-photo-batches",
  15,
  12,
);
const postLimiter = createRateLimiter("family-manage-posts", 15, 60);
const gazetteLimiter = createRateLimiter("family-manage-gazettes", 15, 60);
const inviteLimiter = createRateLimiter("family-manage-invites", 15, 30);
const sendLimiter = createRateLimiter("family-manage-newsletter-sends", 15, 20);

router.use(
  auth,
  requireMembership(),
  requireFamilyModule,
  requireRoles(MANAGER_ROLES),
  scopeToOwnBranch,
  checkFamilyFilters,
);

const view = requirePermission(FAMILY_VIEW);
const manage = requirePermission(FAMILY_MANAGE);

router.get("/", view, controller.getHome);

router.get("/gazette", view, controller.getGazette);
router.get("/gazettes/:gazetteId", view, controller.getGazetteDetail);
router.post(
  "/gazette/generate",
  gazetteLimiter,
  manage,
  staffController.generateGazettes,
);
router.post(
  "/invitations",
  inviteLimiter,
  manage,
  invitationController.inviteFamilyMember,
);

router.get("/uploads", view, staffController.listUploads);
router.get("/join-requests", view, staffController.listJoinRequests);

router.get("/message", view, controller.getPrivateMessage);
router.post("/message", messageLimiter, manage, controller.sendPrivateMessage);

router.get("/posts/taggable-residents", view, controller.listTagOptions);
router.post(
  "/posts/media/batch",
  photoBatchLimiter,
  manage,
  receivePhotos,
  staffController.uploadPostPhotos,
);
router.post(
  "/posts/media",
  photoLimiter,
  manage,
  receivePhoto,
  staffController.uploadPostPhoto,
);
router.get("/posts", view, staffController.listPosts);
router.post("/posts", postLimiter, manage, controller.createPost);
router.put("/posts/:id/reports", manage, staffController.updatePostReports);
router.put("/posts/:id", manage, staffController.updatePost);
router.delete("/posts/:id", manage, staffController.removePost);

router.get("/newsletter", view, controller.getNewsletterScreen);
router.post("/newsletters", manage, controller.createNewsletter);
router.get(
  "/newsletters/:newsletterId/pdf",
  view,
  controller.getNewsletterPdf,
);
router.put(
  "/newsletters/:id/delivery",
  sendLimiter,
  manage,
  staffController.updateNewsletterDelivery,
);
router.get("/newsletters/:id/wall-posts", view, controller.listAddablePosts);
router.post("/newsletters/:id/stories", manage, controller.addStory);
router.get("/newsletters/:id/stories/:storyId", view, controller.getStory);
router.put("/newsletters/:id/stories/:storyId", manage, controller.updateStory);
router.delete(
  "/newsletters/:id/stories/:storyId",
  manage,
  controller.removeStory,
);

module.exports = router;
