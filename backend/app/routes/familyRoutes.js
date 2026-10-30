const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireAudience } = require("@middlewares/audienceMiddleware");
const { AuthAudience } = require("@models/domainEnums");
const {
  requireFamilyAccess,
  requireNextOfKin,
} = require("@middlewares/familyMiddleware");
const {
  receivePhoto,
  receivePhotos,
} = require("@middlewares/familyPhotoMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const familyController = require("../controllers/familyController");

const router = express.Router();

const photoLimiter = createRateLimiter("family-photos", 15, 60);
const photoBatchLimiter = createRateLimiter("family-photo-batches", 15, 12);
const writeLimiter = createRateLimiter("family-writes", 15, 60);
const inviteLimiter = createRateLimiter("family-invites", 15, 20);
const pdfLimiter = createRateLimiter("family-newsletter-pdfs", 15, 30);
const gazettePdfLimiter = createRateLimiter("family-gazette-pdfs", 15, 30);

const residentInQuery = requireFamilyAccess({
  param: "residentId",
  from: "query",
});
const anyResident = requireFamilyAccess();
const residentInBody = requireFamilyAccess({
  param: "residentId",
  from: "body",
});

router.use(auth, requireAudience([AuthAudience.FAMILY]));

router.get("/relationships", familyController.listRelationships);
router.get("/residents", familyController.listMyResidents);
router.get("/home", anyResident, familyController.getHome);

router.get(
  "/codes/current",
  residentInQuery,
  requireNextOfKin,
  familyController.getCurrentFamilyCode,
);
router.post(
  "/codes",
  residentInBody,
  requireNextOfKin,
  familyController.createFamilyCode,
);

router.get(
  "/member-invitations",
  residentInQuery,
  requireNextOfKin,
  familyController.listSentInvitations,
);
router.post(
  "/member-invitations",
  inviteLimiter,
  residentInBody,
  requireNextOfKin,
  familyController.inviteRelative,
);

router.get("/join/preview", familyController.previewJoinCode);
router.post("/join", familyController.requestToJoin);
router.get("/join-requests/current", familyController.getCurrentJoinRequest);

router.get(
  "/join-requests",
  residentInQuery,
  requireNextOfKin,
  familyController.listJoinRequests,
);
router.put("/join-requests/:id", familyController.updateJoinRequest);

router.get("/members", residentInQuery, familyController.listMembers);
router.delete("/members/:memberId", familyController.removeMember);

router.get(
  "/handover/candidates",
  residentInQuery,
  requireNextOfKin,
  familyController.listHandoverCandidates,
);
router.post(
  "/handover",
  residentInBody,
  requireNextOfKin,
  familyController.requestHandover,
);
router.get("/handover/current", familyController.getCurrentHandover);
router.put("/handover/:id", familyController.updateHandover);

router.get("/timeline", residentInQuery, familyController.listTimeline);
router.get("/gallery", residentInQuery, familyController.listGallery);

router.get("/visits/next", residentInQuery, familyController.getNextVisit);
router.get("/visits/options", residentInQuery, familyController.getVisitOptions);
router.get("/visits", residentInQuery, familyController.listVisits);
router.post(
  "/visits",
  writeLimiter,
  residentInBody,
  familyController.requestVisit,
);
router.put(
  "/visits/:id",
  writeLimiter,
  requireFamilyAccess(),
  familyController.updateVisit,
);
router.get("/visit-pass", residentInQuery, familyController.getVisitPass);
router.put(
  "/visit-pass",
  writeLimiter,
  residentInBody,
  familyController.updateVisitPass,
);

router.get("/gazettes/next", residentInQuery, familyController.getNextGazette);
router.get("/gazettes", residentInQuery, familyController.listGazettes);
router.get(
  "/gazettes/:gazetteId",
  requireFamilyAccess(),
  familyController.getGazette,
);
router.get(
  "/gazettes/:gazetteId/pdf",
  gazettePdfLimiter,
  requireFamilyAccess(),
  familyController.downloadGazettePdf,
);

router.get("/newsletters", residentInQuery, familyController.listNewsletters);
router.get(
  "/newsletters/:newsletterId",
  requireFamilyAccess(),
  familyController.getNewsletter,
);
router.get(
  "/newsletters/:newsletterId/pdf",
  pdfLimiter,
  requireFamilyAccess(),
  familyController.downloadNewsletterPdf,
);

router.get("/wall", residentInQuery, familyController.listWall);
router.put("/wall/seen", requireFamilyAccess(), familyController.markPostsSeen);
router.post(
  "/wall/:postId/report",
  writeLimiter,
  requireFamilyAccess(),
  familyController.reportPost,
);
router.put(
  "/wall/:postId/reaction",
  requireFamilyAccess(),
  familyController.addReaction,
);
router.delete(
  "/wall/:postId/reaction",
  requireFamilyAccess(),
  familyController.removeReaction,
);

router.post(
  "/media/batch",
  photoBatchLimiter,
  requireFamilyAccess(),
  receivePhotos,
  familyController.uploadPhotos,
);
router.post(
  "/media",
  photoLimiter,
  requireFamilyAccess(),
  receivePhoto,
  familyController.uploadPhoto,
);
router.post(
  "/uploads",
  writeLimiter,
  residentInBody,
  familyController.createUpload,
);
router.get("/uploads", requireFamilyAccess(), familyController.listMyUploads);
router.put(
  "/uploads/:id",
  requireFamilyAccess(),
  familyController.updateUpload,
);

router.post("/leave", residentInBody, familyController.leaveFamily);

module.exports = router;
