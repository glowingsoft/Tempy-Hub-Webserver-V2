const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireAudience } = require("@middlewares/audienceMiddleware");
const {
  requireMembership,
  requireRoles,
  requirePermission,
} = require("@middlewares/membershipMiddleware");
const {
  requireFamilyModule,
  checkFamilyFilters,
} = require("@middlewares/familyMiddleware");
const { AuthAudience } = require("@models/domainEnums");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_STAFF_ROLES,
} = require("@adminServices/family/familyAccess");
const createRateLimiter = require("@utils/rateLimiter");
const messageController = require("../controllers/messageController");

const router = express.Router();
router.use(auth);

const readLimiter = createRateLimiter("chat-reads", 10, 120);
const actionLimiter = createRateLimiter("chat-actions", 10, 60);
const sendLimiter = createRateLimiter("chat-sends", 15, 20);

const asFamily = requireAudience([AuthAudience.FAMILY]);

const asStaff = [
  requireAudience([AuthAudience.STAFF]),
  requireMembership(),
  requireFamilyModule,
  requireRoles(FAMILY_STAFF_ROLES),
  checkFamilyFilters,
];

router.get("/", readLimiter, asFamily, messageController.listChats);
router.get("/messages", readLimiter, asFamily, messageController.listChatMessages);
router.put("/:conversationId/action", actionLimiter, asFamily, messageController.updateChat);

router.post("/message", sendLimiter, ...asStaff, requirePermission(FAMILY_MANAGE), messageController.sendMessage);
router.get("/contacts", readLimiter, ...asStaff, requirePermission(FAMILY_VIEW), messageController.listContacts);
router.get("/contacts/:conversationId", readLimiter, ...asStaff, requirePermission(FAMILY_VIEW), messageController.getContact);
router.get("/recipients", readLimiter, ...asStaff, requirePermission(FAMILY_VIEW), messageController.listRecipients);
router.get("/sent", readLimiter, ...asStaff, requirePermission(FAMILY_VIEW), messageController.listSentMessages);
router.get("/sent/:broadcastId", readLimiter, ...asStaff, requirePermission(FAMILY_VIEW), messageController.getSentMessage);

module.exports = router;
