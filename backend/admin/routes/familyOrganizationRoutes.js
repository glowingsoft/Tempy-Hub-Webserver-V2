const express = require("express");
const { requireRoles, requirePermission } = require("@middlewares/membershipMiddleware");
const { requireFamilyModule, checkFamilyFilters } = require("@middlewares/familyMiddleware");
const { FAMILY_VIEW, FAMILY_STAFF_ROLES } = require("@adminServices/family/familyAccess");
const familyInvitationController = require("../controllers/familyInvitationController");
const createRateLimiter = require("@utils/rateLimiter");
const familyStaffController = require("../controllers/familyStaffController");

const router = express.Router({ mergeParams: true });

const pdfLimiter = createRateLimiter("family-newsletter-pdf-previews", 15, 30);

// Per-route guards: a router-level guard would also run for the organization routes declared after this mount.
const canViewFamily = [requireFamilyModule, requireRoles(FAMILY_STAFF_ROLES), requirePermission(FAMILY_VIEW), checkFamilyFilters];

router.get("/family-invitations", canViewFamily, familyInvitationController.listInvitations);
router.get("/family-posts", canViewFamily, familyStaffController.listPosts);
router.get("/family-newsletters", canViewFamily, familyStaffController.listNewsletters);
router.get("/family-newsletters/:newsletterId", canViewFamily, familyStaffController.getNewsletter);
router.get("/family-newsletters/:newsletterId/pdf", pdfLimiter, canViewFamily, familyStaffController.downloadNewsletterPdf);
router.get("/family-uploads", canViewFamily, familyStaffController.listUploads);
router.get("/family-groups", canViewFamily, familyStaffController.listFamilyGroups);
router.get("/family-groups/:residentId", canViewFamily, familyStaffController.getFamilyGroup);
router.get("/family-members", canViewFamily, familyStaffController.listAllMembers);
router.get("/family-members/:memberId", canViewFamily, familyStaffController.getMember);
router.get("/family-invitations/:invitationId", canViewFamily, familyInvitationController.getInvitation);

module.exports = router;
