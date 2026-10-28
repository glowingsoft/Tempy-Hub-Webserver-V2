const express = require("express");
const auth = require("@middlewares/authMiddleware");
const familyInvitationController = require("../controllers/familyInvitationController");

const router = express.Router();

router.use(auth);

router.get("/", familyInvitationController.listMyInvitations);
router.get("/:invitationId", familyInvitationController.getMyInvitation);
router.post(
  "/:invitationId/accept",
  familyInvitationController.acceptMyInvitation,
);

module.exports = router;
