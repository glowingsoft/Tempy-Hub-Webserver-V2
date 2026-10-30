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
const staffDashboardSettingsController = require("../controllers/staffDashboardSettingsController");

const branchController = require("../controllers/branchController");

const membershipController = require("../controllers/membershipController");

const staffController = require("../controllers/staffController");
const supervisionController = require("../controllers/supervisionController");
const appraisalController = require("../controllers/appraisalController");
const shiftController = require("../controllers/shiftController");
const attendanceController = require("../controllers/attendanceController");
const leaveController = require("../controllers/leaveController");
const evacuationController = require("../controllers/evacuationController");
const externalPersonController = require("../controllers/externalPersonController");
const visitSessionController = require("../controllers/visitSessionController");
const siteLiveController = require("../../app/controllers/siteLiveController");
const teamLiveController = require("../../app/controllers/teamLiveController");
const visitorInvitationController = require("../controllers/visitorInvitationController");
const visitorAccountInvitationController = require("../controllers/visitorAccountInvitationController");
const residentMediaController = require("../controllers/residentMediaController");
const floorPlanController = require("../controllers/floorPlanController");
const peepRecordController = require("../controllers/peepRecordController");
const kioskWidgetController = require("../controllers/kioskWidgetController");
const documentController = require("../controllers/documentController");
const requirementController = require("../controllers/requirementController");
const familyOrganizationRoutes = require("./familyOrganizationRoutes");
const {
  ROTA_MANAGE,
  ROTA_APPROVE,
} = require("@adminServices/rota/shiftAccess");
const { TEAM_APPROVER_ROLES } = require("@adminServices/staff/staffAccess");
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
const {
  PEEP_VIEW,
  PEEP_MANAGE,
} = require("@adminServices/peep/floorPlanAccess");
const {
  DOCUMENTS_VIEW,
  DOCUMENTS_MANAGE,
} = require("@adminServices/documents/documentAccess");

const router = express.Router();

router.use(auth);

const OWNER_OR_SA = [MembershipRole.SUPER_ADMIN, MembershipRole.OWNER];

const MANAGERS = [...OWNER_OR_SA, MembershipRole.SITE_MANAGER];
const INVITERS = [...MANAGERS, MembershipRole.LINE_MANAGER];

// Creation and cross-org listing cannot be membership-scoped: the organization

// does not exist yet, or the caller is asking which organizations they belong to.

router.post("/", organizationController.createOrganization);

router.get("/", organizationController.listOrganizations);

const scoped = express.Router({ mergeParams: true });

scoped.use(requireMembership());

scoped.get(
  "/site-live/activity",
  requireRoles(MANAGERS),
  siteLiveController.getSiteLiveActivity,
);

scoped.get(
  "/site-live",
  requireRoles(MANAGERS),
  siteLiveController.getSiteLive,
);

scoped.get(
  "/team-live/activity",
  requireRoles(TEAM_APPROVER_ROLES),
  teamLiveController.getTeamLiveActivity,
);

scoped.get(
  "/team-live/rota",
  requireRoles(TEAM_APPROVER_ROLES),
  teamLiveController.getTeamRota,
);

scoped.get(
  "/team-live",
  requireRoles(TEAM_APPROVER_ROLES),
  teamLiveController.getTeamLive,
);

scoped.get("/", organizationController.getOrganization);

scoped.patch("/", requireRoles(OWNER_OR_SA), organizationController.updateOrganization);

scoped.get(
  "/staff-dashboard-settings",
  requireRoles(OWNER_OR_SA),
  staffDashboardSettingsController.getStaffDashboardSettings
);
scoped.put(
  "/staff-dashboard-settings",
  requireRoles(OWNER_OR_SA),
  staffDashboardSettingsController.saveStaffDashboardSettings
);
scoped.post(
  "/staff-dashboard-settings/reset",
  requireRoles(OWNER_OR_SA),
  staffDashboardSettingsController.resetStaffDashboardSettings
);

scoped.get(
  "/module-access",

  requireRoles(OWNER_OR_SA),

  organizationController.getModuleAccess,
);

scoped.put(
  "/module-access",

  requireRoles(OWNER_OR_SA),

  organizationController.setModuleAccess,
);

scoped.post(
  "/branches",
  requireRoles(OWNER_OR_SA),
  branchController.createBranch,
);

scoped.get("/branches", branchController.listBranches);

scoped.get("/members", membershipController.listMembers);

scoped.use(familyOrganizationRoutes);

scoped.get(
  "/grantable-permissions",

  requireRoles(INVITERS),

  membershipController.listGrantablePermissions,
);

scoped.post(
  "/invitations",

  requireRoles(INVITERS),

  membershipController.inviteMember,
);

scoped.get(
  "/invitations",

  requireRoles(MANAGERS),

  membershipController.listInvitations,
);

scoped.get(
  "/invitations/:invitationId",
  requireRoles(MANAGERS),
  membershipController.getInvitation,
);
scoped.patch(
  "/invitations/:invitationId",
  requireRoles(INVITERS),
  membershipController.updateInvitation
);

scoped.post(
  "/departments",

  requireRoles(MANAGERS),

  staffController.createDepartment,
);

scoped.get("/departments", staffController.listDepartments);

scoped.get("/departments/:departmentId", staffController.getDepartment);

scoped.patch(
  "/departments/:departmentId",
  requireRoles(MANAGERS),
  staffController.updateDepartment,
);

scoped.post(
  "/job-titles",

  requireRoles(MANAGERS),

  staffController.createJobTitle,
);

scoped.get("/job-titles", staffController.listJobTitles);

scoped.patch(
  "/job-titles/:jobTitleId",
  requireRoles(MANAGERS),
  staffController.updateJobTitle,
);

scoped.post(
  "/staff-profiles",

  requireRoles(MANAGERS),

  staffController.createStaffProfile,
);

scoped.get("/staff-profiles/direct-reports", staffController.listDirectReports);

scoped.get("/staff-profiles", staffController.listStaffProfiles);

scoped.patch(
  "/staff-profiles/:staffProfileId/compliance-settings",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.updateStaffComplianceSettings
);
scoped.patch(
  "/staff-profiles/:staffProfileId/supervision-settings",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.updateSupervisionSettings
);
scoped.get(
  "/supervision",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.listTeamSupervision
);
scoped.post(
  "/supervision",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.createSupervision
);
scoped.get(
  "/supervision/:supervisionId",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.getSupervision
);
scoped.put(
  "/supervision/:supervisionId",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.updateSupervision
);
scoped.post(
  "/supervision/:supervisionId/action-points/sign-off",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.signOffActionPoints
);
scoped.post(
  "/supervision/:supervisionId/action-points/:actionPointId/sign-off",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  supervisionController.signOffActionPoint
);
scoped.patch(
  "/staff-profiles/:staffProfileId/appraisal-settings",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.updateAppraisalSettings
);
scoped.get(
  "/compliance-history",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.listComplianceHistory
);
scoped.get(
  "/appraisals",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.listTeamAppraisals
);
scoped.post(
  "/appraisals",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.createAppraisal
);
scoped.get(
  "/appraisals/:appraisalId",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.getAppraisal
);
scoped.put(
  "/appraisals/:appraisalId",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.updateAppraisal
);
scoped.post(
  "/appraisals/:appraisalId/action-points/sign-off",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.signOffActionPoints
);
scoped.post(
  "/appraisals/:appraisalId/action-points/:actionPointId/sign-off",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.signOffActionPoint
);
scoped.post(
  "/appraisals/:appraisalId/manager-sign",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  appraisalController.managerSignAppraisal
);
scoped.get(
  "/requirements",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.listRequirements
);
scoped.get(
  "/requirements/:requirementId",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.getRequirement
);
scoped.post(
  "/requirements",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.createRequirement
);
scoped.get(
  "/assignments",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.listAssignments
);
scoped.post(
  "/assignments",
  requireRoles(TEAM_APPROVER_ROLES),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.createAssignments
);
scoped.get(
  "/competency-matrix",
  requireRoles([...TEAM_APPROVER_ROLES, MembershipRole.STAFF]),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.competencyMatrix
);
scoped.get(
  "/training-records",
  requireRoles([...TEAM_APPROVER_ROLES, MembershipRole.STAFF]),
  requireModule(ModuleSlug.COMPETENCY_SUPERVISION_APPRAISAL),
  requirementController.listTrainingRecords
);

scoped.post(
  "/shifts",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  requirePermission(ROTA_MANAGE),
  shiftController.createShift,
);
scoped.get(
  "/shifts",
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  shiftController.listShifts,
);
scoped.get(
  "/shift-claims",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  requirePermission(ROTA_APPROVE),
  shiftController.listClaims,
);
scoped.get(
  "/shift-claims/:claimId",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.ROTA_SCHEDULING),
  requirePermission(ROTA_APPROVE),
  shiftController.getClaim
);

scoped.get(
  "/attendance/rota",
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_VIEW),
  attendanceController.listAttendanceRota,
);
scoped.get(
  "/attendance",
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_VIEW),
  attendanceController.listAttendanceDays,
);
scoped.post(
  "/attendance/:attendanceDayId/approve-roster",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_APPROVE),
  attendanceController.approveRoster
);
scoped.post(
  "/attendance/:attendanceDayId/reject-roster",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_APPROVE),
  attendanceController.rejectRoster
);
scoped.get(
  "/attendance-change-requests",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  requirePermission(ATTENDANCE_APPROVE),
  attendanceController.listChangeRequests,
);

scoped.get(
  "/leave-requests",
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_VIEW),
  leaveController.listLeaveRequests,
);
scoped.get(
  "/leave-requests/:requestId",
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_VIEW),
  leaveController.getLeaveRequest
);
scoped.post(
  "/leave-requests/record",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_MANAGE),
  leaveController.recordManagerLeave,
);
scoped.get(
  "/leave-entitlements",
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_VIEW),
  leaveController.listEntitlements,
);
scoped.get(
  "/leave-scores",
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_VIEW),
  leaveController.listLeaveScores,
);
scoped.put(
  "/leave-entitlements",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.LEAVE),
  requirePermission(LEAVE_MANAGE),
  leaveController.upsertEntitlement,
);

scoped.get(
  "/evacuations/on-site-summary",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_VIEW),
  evacuationController.getOnSiteSummary,
);
scoped.get(
  "/evacuations/active",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_VIEW),
  evacuationController.getActiveEvacuation,
);
scoped.get(
  "/evacuations",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_VIEW),
  evacuationController.listEvacuations,
);
scoped.post(
  "/evacuations",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(EVAC_MANAGE),
  evacuationController.startEvacuation,
);

// Visitors / contractors — seed + check-in so fire-drill on-site counts are non-zero (Figma Screen 86).
scoped.post(
  "/external-people",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  externalPersonController.createExternalPerson,
);
scoped.get(
  "/external-people",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  externalPersonController.listExternalPeople,
);

scoped.get(
  "/visit-sessions/on-site-counts",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitSessionController.getOnSiteCounts,
);
scoped.get(
  "/visit-sessions/analytics",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitSessionController.getVisitAnalytics,
);
scoped.post(
  "/visit-sessions/register-and-check-in",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitSessionController.registerAndCheckIn,
);
scoped.post(
  "/visit-sessions/check-in",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitSessionController.checkIn,
);
scoped.post(
  "/visitor-invitations",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitorInvitationController.createVisitorInvitation,
);
scoped.post(
  "/visitor-account-invitations",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitorAccountInvitationController.createVisitorAccountInvitation
);
scoped.get(
  "/visitor-account-invitations",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitorAccountInvitationController.listVisitorAccountInvitations
);
scoped.post(
  "/visitor-account-invitations/:invitationId/resend",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitorAccountInvitationController.resendVisitorAccountInvitation
);
scoped.post(
  "/visitor-account-invitations/:invitationId/revoke",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_MANAGE),
  visitorAccountInvitationController.revokeVisitorAccountInvitation
);
scoped.get(
  "/visitor-invitations",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitorInvitationController.listVisitorInvitations,
);
scoped.get(
  "/visit-sessions",
  requireModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  requirePermission(VISIT_VIEW),
  visitSessionController.listVisitSessions,
);

scoped.get(
  "/kiosk-widgets",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  kioskWidgetController.listKioskWidgets
);
scoped.put(
  "/kiosk-widgets",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.SIGN_IN_ATTENDANCE),
  kioskWidgetController.saveKioskWidgets
);

scoped.get(
  "/floor-plans",
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_VIEW),
  floorPlanController.listFloorPlans,
);
scoped.post(
  "/floor-plans",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_MANAGE),
  floorPlanController.createFloorPlan,
);

scoped.get(
  "/peep-floor-summary",
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_VIEW),
  peepRecordController.getPeepFloorSummary,
);
scoped.get(
  "/peep-records",
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_VIEW),
  peepRecordController.listPeepRecords,
);
scoped.post(
  "/peep-records",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_MANAGE),
  peepRecordController.createPeepRecord,
);
scoped.get(
  "/residents/:residentId/peep-record",
  requireModule(ModuleSlug.PEEP_FLOOR_PLAN),
  requirePermission(PEEP_VIEW),
  peepRecordController.getPeepRecordByResident,
);

const CATEGORY_MANAGERS = [...MANAGERS, MembershipRole.LINE_MANAGER];

scoped.get(
  "/document-categories",
  requireModule(ModuleSlug.DOCUMENTS_ESIGN),
  requirePermission(DOCUMENTS_VIEW),
  documentController.listDocumentCategories
);
scoped.post(
  "/document-categories",
  requireRoles(CATEGORY_MANAGERS),
  requireModule(ModuleSlug.DOCUMENTS_ESIGN),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.createDocumentCategory
);
scoped.patch(
  "/document-categories/:categoryId",
  requireRoles(CATEGORY_MANAGERS),
  requireModule(ModuleSlug.DOCUMENTS_ESIGN),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.updateDocumentCategory
);
scoped.delete(
  "/document-categories/:categoryId",
  requireRoles(CATEGORY_MANAGERS),
  requireModule(ModuleSlug.DOCUMENTS_ESIGN),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.deleteDocumentCategory
);
scoped.get(
  "/documents",
  requireModule(ModuleSlug.DOCUMENTS_ESIGN),
  requirePermission(DOCUMENTS_VIEW),
  documentController.listDocuments
);
scoped.post(
  "/documents",
  requireRoles(MANAGERS),
  requireModule(ModuleSlug.DOCUMENTS_ESIGN),
  requirePermission(DOCUMENTS_MANAGE),
  documentController.createDocument
);

scoped.get(
  "/resident-media",
  requireRoles(MANAGERS),
  residentMediaController.listResidentMedia,
);
scoped.post(
  "/resident-media/:mediaId/review",
  requireRoles(MANAGERS),
  residentMediaController.reviewResidentMedia,
);

router.use("/:organizationId", scoped);

module.exports = router;
