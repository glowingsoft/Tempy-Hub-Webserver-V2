const express = require("express");

const auth = require("@middlewares/authMiddleware");

const {

  requireMembership,

  requireRoles,
  requireModule,
  requirePermission,

} = require("@middlewares/membershipMiddleware");

const { MembershipRole, ModuleSlug } = require("@models/domainEnums");

const organizationController = require("../controllers/organizationController");

const branchController = require("../controllers/branchController");

const membershipController = require("../controllers/membershipController");

const staffController = require("../controllers/staffController");
const shiftController = require("../controllers/shiftController");
const attendanceController = require("../controllers/attendanceController");
const leaveController = require("../controllers/leaveController");
const evacuationController = require("../controllers/evacuationController");
const externalPersonController = require("../controllers/externalPersonController");
const visitSessionController = require("../controllers/visitSessionController");
const visitorInvitationController = require("../controllers/visitorInvitationController");
const { ROTA_MANAGE, ROTA_APPROVE } = require("@adminServices/rota/shiftAccess");
const {
  ATTENDANCE_VIEW,
  ATTENDANCE_APPROVE,
} = require("@adminServices/attendance/attendanceAccess");
const {
  LEAVE_VIEW,
  LEAVE_MANAGE,
  LEAVE_APPROVE,
} = require("@adminServices/leave/leaveAccess");
const {
  EVAC_VIEW,
  EVAC_MANAGE,
} = require("@adminServices/evacuation/evacuationAccess");
const {
  VISIT_VIEW,
  VISIT_MANAGE,
} = require("@adminServices/visitors/visitorAccess");



const router = express.Router();



router.use(auth);



const OWNER_OR_SA = [MembershipRole.SUPER_ADMIN, MembershipRole.OWNER];

const MANAGERS = [...OWNER_OR_SA, MembershipRole.SITE_MANAGER];



// Creation and cross-org listing cannot be membership-scoped: the organization

// does not exist yet, or the caller is asking which organizations they belong to.

router.post("/", organizationController.createOrganization);

router.get("/", organizationController.listOrganizations);



const scoped = express.Router({ mergeParams: true });

scoped.use(requireMembership());



scoped.get("/", organizationController.getOrganization);

scoped.patch("/", requireRoles(OWNER_OR_SA), organizationController.updateOrganization);



scoped.get(

  "/module-access",

  requireRoles(OWNER_OR_SA),

  organizationController.getModuleAccess

);

scoped.put(

  "/module-access",

  requireRoles(OWNER_OR_SA),

  organizationController.setModuleAccess

);



scoped.post("/branches", requireRoles(OWNER_OR_SA), branchController.createBranch);

scoped.get("/branches", branchController.listBranches);



scoped.get("/members", membershipController.listMembers);

scoped.get(

  "/grantable-permissions",

  requireRoles(MANAGERS),

  membershipController.listGrantablePermissions

);

scoped.post(

  "/invitations",

  requireRoles(MANAGERS),

  membershipController.inviteMember

);

scoped.get(

  "/invitations",

  requireRoles(MANAGERS),

  membershipController.listInvitations

);



scoped.post(

  "/departments",

  requireRoles(MANAGERS),

  staffController.createDepartment

);

scoped.get("/departments", staffController.listDepartments);



scoped.post(

  "/job-titles",

  requireRoles(MANAGERS),

  staffController.createJobTitle

);

scoped.get("/job-titles", staffController.listJobTitles);



scoped.post(

  "/staff-profiles",

  requireRoles(MANAGERS),

  staffController.createStaffProfile

);

scoped.get(
  "/staff-profiles/direct-reports",
  staffController.listDirectReports
);

scoped.get("/staff-profiles", staffController.listStaffProfiles);

scoped.post(
  "/shifts",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  requirePermission(ROTA_MANAGE),
  shiftController.createShift
);
scoped.get(
  "/shifts",
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  shiftController.listShifts
);
scoped.get(
  "/shift-claims",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  requirePermission(ROTA_APPROVE),
  shiftController.listClaims
);

scoped.get(
  "/attendance/rota",
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_VIEW),
  attendanceController.listAttendanceRota
);
scoped.get(
  "/attendance",
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_VIEW),
  attendanceController.listAttendanceDays
);
scoped.get(
  "/attendance-change-requests",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_APPROVE),
  attendanceController.listChangeRequests
);

scoped.get(
  "/leave-requests",
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_VIEW),
  leaveController.listLeaveRequests
);
scoped.post(
  "/leave-requests/record",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_MANAGE),
  leaveController.recordManagerLeave
);
scoped.get(
  "/leave-entitlements",
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_VIEW),
  leaveController.listEntitlements
);
scoped.put(
  "/leave-entitlements",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_MANAGE),
  leaveController.upsertEntitlement
);

scoped.get(
  "/evacuations/on-site-summary",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_VIEW),
  evacuationController.getOnSiteSummary
);
scoped.get(
  "/evacuations/active",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_VIEW),
  evacuationController.getActiveEvacuation
);
scoped.get(
  "/evacuations",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_VIEW),
  evacuationController.listEvacuations
);
scoped.post(
  "/evacuations",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_MANAGE),
  evacuationController.startEvacuation
);

// Visitors / contractors — seed + check-in so fire-drill on-site counts are non-zero (Figma Screen 86).
scoped.post(
  "/external-people",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  externalPersonController.createExternalPerson
);
scoped.get(
  "/external-people",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  externalPersonController.listExternalPeople
);

scoped.get(
  "/visit-sessions/on-site-counts",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitSessionController.getOnSiteCounts
);
scoped.get(
  "/visit-sessions/analytics",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitSessionController.getVisitAnalytics
);
scoped.post(
  "/visit-sessions/register-and-check-in",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitSessionController.registerAndCheckIn
);
scoped.post(
  "/visit-sessions/check-in",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitSessionController.checkIn
);
scoped.post(
  "/visitor-invitations",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitorInvitationController.createVisitorInvitation
);
scoped.get(
  "/visitor-invitations",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitorInvitationController.listVisitorInvitations
);
scoped.get(
  "/visit-sessions",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitSessionController.listVisitSessions
);

router.use("/:organizationId", scoped);



module.exports = router;

