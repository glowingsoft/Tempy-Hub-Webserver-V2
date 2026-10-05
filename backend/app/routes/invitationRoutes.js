const express = require("express");
const auth = require("@middlewares/authMiddleware");
const invitationController = require("../controllers/invitationController");

const router = express.Router();

router.use(auth);

router.get("/", invitationController.listMyInvitations);
router.get("/:invitationId", invitationController.getMyInvitation);
router.post("/:invitationId/accept", invitationController.acceptMyInvitation);

module.exports = router;
