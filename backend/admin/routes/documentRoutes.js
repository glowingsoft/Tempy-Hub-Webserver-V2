const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireRoles,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { MembershipRole, ModuleSlug } = require("@models/domainEnums");
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

const MANAGERS = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

router.get(
  "/:documentId/acknowledgements",
  requirePermission(DOCUMENTS_VIEW),
  documentController.listAcknowledgements
);
router.post(
  "/:documentId/versions",
  requireRoles(MANAGERS),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.addDocumentVersion
);
router.get(
  "/:documentId",
  requirePermission(DOCUMENTS_VIEW),
  documentController.getDocument
);
router.patch(
  "/:documentId",
  requireRoles(MANAGERS),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.updateDocument
);
router.delete(
  "/:documentId",
  requireRoles(MANAGERS),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.deleteDocument
);

module.exports = router;
