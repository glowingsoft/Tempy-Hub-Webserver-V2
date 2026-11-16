const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug, MembershipRole } = require("@models/domainEnums");
const documentController = require("../controllers/documentController");
const {
  DOCUMENTS_VIEW,
  DOCUMENTS_MANAGE,
} = require("@adminServices/documents/documentAccess");

const router = express.Router();

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

router.get("/folders", asManager, requirePermission(DOCUMENTS_VIEW), documentController.listFolders);
router.post("/folders", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.createFolder);
router.post("/bulk-upload", asManager, requirePermission(DOCUMENTS_MANAGE), documentController.bulkUpload);

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
