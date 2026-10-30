const express = require("express");
const router = express.Router();


const homeRoutes = require("./homeRoutes");
const siteLiveRoutes = require("./siteLiveRoutes");
const teamLiveRoutes = require("./teamLiveRoutes");
const usersRoutes = require("./userRoutes");
const settingsRoutes = require("./settingsRoutes");
const supportRoutes = require("./supportRoutes");
const shiftRoutes = require("./shiftRoutes");
const shiftClaimRoutes = require("./shiftClaimRoutes");
const attendanceRoutes = require("./attendanceRoutes");
const leaveRoutes = require("./leaveRoutes");
const kioskRoutes = require("./kioskRoutes");
const invitationRoutes = require("./invitationRoutes");
const evacuationRoutes = require("./evacuationRoutes");
const familyInvitationRoutes = require("./familyInvitationRoutes");
const familyRoutes = require("./familyRoutes");
const familyVisitManagerRoutes = require("./familyVisitManagerRoutes");


router.use("/support", supportRoutes);
router.use("/kiosk", kioskRoutes);
router.use("/invitations", invitationRoutes);
router.use("/family-invitations", familyInvitationRoutes);
router.use("/family", familyRoutes);
router.use("/family-visits", familyVisitManagerRoutes);
router.use("/shifts", shiftRoutes);
router.use("/shift-claims", shiftClaimRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/leave-requests", leaveRoutes);
router.use("/evacuations", evacuationRoutes);
router.use("/settings", settingsRoutes);
router.use("/home", homeRoutes);
router.use("/site-live", siteLiveRoutes);
router.use("/team-live", teamLiveRoutes);
router.use("/users", usersRoutes);


module.exports = router;