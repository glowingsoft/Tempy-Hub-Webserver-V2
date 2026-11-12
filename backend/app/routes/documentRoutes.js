const express = require("express");
const auth = require("@middlewares/authMiddleware");
const {
  requireMembership,
  requireModule,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const documentController = require("../controllers/documentController");
const { DOCUMENTS_VIEW } = require("@adminServices/documents/documentAccess");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.DOCUMENTS_ESIGN)
);

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
