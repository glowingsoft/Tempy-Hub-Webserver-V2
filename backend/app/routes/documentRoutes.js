const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const createRateLimiter = require("@utils/rateLimiter");
const documentController = require("../controllers/documentController");
const { receiveDocuments } = require("@middlewares/documentUploadMiddleware");
const {
  DOCUMENTS_VIEW,
  DOCUMENTS_MANAGE,
} = require("@adminServices/documents/documentAccess");

const router = express.Router();

router.get(
  "/shared/:token",
  createRateLimiter("shared-documents", 15, 60),
  documentController.openSharedDocument,
);

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.DOCUMENTS_ESIGN)
);

const asManager = requireRoles([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
]);

router.get("/library", asManager, requirePermission(DOCUMENTS_VIEW), documentController.listLibrary);
router.post("/bulk-upload", asManager, requirePermission(DOCUMENTS_MANAGE), receiveDocuments, documentController.bulkUpload);
router.get("/:documentId/signature-request", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.getSignatureRequest);
router.post("/:documentId/signature-request", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.sendForSignature);
router.delete("/:documentId", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.deleteDocument);
router.get("/visitor-library", asManager, requirePermission(DOCUMENTS_VIEW), documentController.listVisitorDocuments);
router.post("/qr-code", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.createQrCode);
router.post("/:documentId/qr-link/regenerate", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.regenerateQrLink);
router.delete("/:documentId/qr-link", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.revokeQrLink);

router.get("/", requirePermission(DOCUMENTS_VIEW), documentController.listDocuments);
router.post(
  "/:documentId/sign",
  requirePermission(DOCUMENTS_VIEW),
  documentController.signDocument
);
router.get(
  "/:documentId",
  requirePermission(DOCUMENTS_VIEW),
  documentController.getDocument
);

module.exports = router;
