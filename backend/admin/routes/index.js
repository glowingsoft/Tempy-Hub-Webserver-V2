const express = require("express");

const router = express.Router();

const auth = require("@middlewares/authMiddleware");

const bulkInsertRoutes = require("./dbRoutes.js");

const adminSettingsRoutes = require("./settingsRoutes.js");

const organizationRoutes = require("./organizationRoutes.js");
const billingRoutes = require("./billingRoutes.js");

const branchRoutes = require("./branchRoutes.js");

const membershipRoutes = require("./membershipRoutes.js");

const invitationRoutes = require("./invitationRoutes.js");

const departmentRoutes = require("./departmentRoutes.js");

const jobTitleRoutes = require("./jobTitleRoutes.js");

const staffProfileRoutes = require("./staffProfileRoutes.js");
const shiftRoutes = require("./shiftRoutes.js");
const shiftClaimRoutes = require("./shiftClaimRoutes.js");
const attendanceRoutes = require("./attendanceRoutes.js");
const attendanceChangeRequestRoutes = require("./attendanceChangeRequestRoutes.js");
const leaveRequestRoutes = require("./leaveRequestRoutes.js");
const leaveApprovalRoutes = require("./leaveApprovalRoutes.js");
const evacuationRoutes = require("./evacuationRoutes.js");
const externalPersonRoutes = require("./externalPersonRoutes.js");
const visitSessionRoutes = require("./visitSessionRoutes.js");
const visitorInvitationRoutes = require("./visitorInvitationRoutes.js");
const residentRoutes = require("./residentRoutes.js");
const familyInvitationRoutes = require("./familyInvitationRoutes.js");
const familyStaffRoutes = require("./familyStaffRoutes.js");
const kioskAdminRoutes = require("./kioskAdminRoutes.js");
const floorPlanRoutes = require("./floorPlanRoutes.js");
const peepRecordRoutes = require("./peepRecordRoutes.js");
const documentRoutes = require("./documentRoutes.js");
const requirementRoutes = require("./requirementRoutes.js");
const assignmentRoutes = require("./assignmentRoutes.js");

const {
  listModuleDefinitions,
} = require("../controllers/organizationController");

router.use("/settings", adminSettingsRoutes);

//db utils routes

router.use("/util", bulkInsertRoutes);

router.use("/billing", billingRoutes);

router.use("/organizations", organizationRoutes);

router.use("/branches", branchRoutes);

router.use("/memberships", membershipRoutes);

router.use("/invitations", invitationRoutes);

router.use("/departments", departmentRoutes);

router.use("/job-titles", jobTitleRoutes);

router.use("/staff-profiles", staffProfileRoutes);
router.use("/shifts", shiftRoutes);
router.use("/shift-claims", shiftClaimRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/attendance-change-requests", attendanceChangeRequestRoutes);
router.use("/leave-requests", leaveRequestRoutes);
router.use("/leave-approvals", leaveApprovalRoutes);
router.use("/evacuations", evacuationRoutes);
router.use("/external-people", externalPersonRoutes);
router.use("/visit-sessions", visitSessionRoutes);
router.use("/visitor-invitations", visitorInvitationRoutes);
router.use("/residents", residentRoutes);
router.use("/family-invitations", familyInvitationRoutes);
router.use("/family", familyStaffRoutes);
router.use("/kiosks", kioskAdminRoutes);
router.use("/floor-plans", floorPlanRoutes);
router.use("/peep-records", peepRecordRoutes);
router.use("/documents", documentRoutes);
router.use("/requirements", requirementRoutes);
router.use("/assignments", assignmentRoutes);

router.get("/module-definitions", auth, listModuleDefinitions);

module.exports = router;
