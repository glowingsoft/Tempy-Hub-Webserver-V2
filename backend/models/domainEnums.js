/**
 * Shared enums for Tempy Hub domain models (care-home SaaS).
 * Keep in sync with docs/discovery/2026-08-27-domain-schema.md
 */

const MembershipRole = {
  SUPER_ADMIN: "superAdmin",
  OWNER: "owner",
  SITE_MANAGER: "siteManager",
  LINE_MANAGER: "lineManager",
  STAFF: "staff",
};

/** Higher number = more privilege. One map for grants, login surfaces, and APIs. */
const MembershipRoleRank = {
  [MembershipRole.SUPER_ADMIN]: 5,
  [MembershipRole.OWNER]: 4,
  [MembershipRole.SITE_MANAGER]: 3,
  [MembershipRole.LINE_MANAGER]: 2,
  [MembershipRole.STAFF]: 1,
};

/**
 * Which product the client is (not the same as Membership.role).
 * Login may send this so a line manager cannot enter the owner/platform portal.
 * Higher membership rank may open a lower-ranked portal.
 */
const AppSurface = {
  STAFF_APP: "staffApp",
  MANAGER_APP: "managerApp",
  OWNER_ADMIN: "ownerAdmin",
  PLATFORM_ADMIN: "platformAdmin",
  RESIDENT_APP: "residentApp",
  VISITOR_APP: "visitorApp",
};

/** Which client surface a JWT was issued for; route groups validate this. */
const AuthAudience = {
  STAFF: "staff",
  VISITOR: "visitor",
  RESIDENT: "resident",
  KIOSK: "kiosk",
};

const StaffInvitationStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

const ModuleSlug = {
  SIGN_IN_ATTENDANCE: "signInAttendance",
  ROTA_SCHEDULING: "rotaScheduling",
  FIRE_DRILL_EVACUATION: "fireDrillEvacuation",
  PEEP_FLOOR_PLAN: "peepFloorPlan",
  RESIDENTS: "residents",
  DOCUMENTS_ESIGN: "documentsEsign",
  /**
   * Split from the former `leaveShiftBidding`: a customer may run leave in
   * another system while still using shift bidding here, or the reverse.
   */
  LEAVE: "leave",
  SHIFT_BIDDING: "shiftBidding",
  COMPETENCY_SUPERVISION_APPRAISAL: "competencySupervisionAppraisal",
  ONBOARDING_DBS: "onboardingDbs",
  PAYROLL_FORECASTING: "payrollForecasting",
  VISITOR_COMMS: "visitorComms",
  AGENCY_SHIFT_BIDS: "agencyShiftBids",
  FAMILY_ENGAGEMENT: "familyEngagement",
};

const OrganizationStatus = {
  /** Created by the platform operator; waiting for its owner to accept. */
  PENDING_ACTIVATION: "pendingActivation",
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

const BranchStatus = {
  PENDING_ACTIVATION: "pendingActivation",
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

const ActivationCodeStatus = {
  ACTIVE: "active",
  USED: "used",
  REVOKED: "revoked",
  EXPIRED: "expired",
  /** Attempt budget exhausted; must be reissued. */
  LOCKED: "locked",
};

const ActiveInactiveStatus = {
  ACTIVE: "active",
  INACTIVE: "inactive",
};

const StaffProfileStatus = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  ON_LEAVE: "onLeave",
};

const JobTitleLevel = {
  EXECUTIVE: "executive",
  SITE_MANAGEMENT: "siteManagement",
  OPERATIONAL: "operational",
};

const StaffAssetStatus = {
  ASSIGNED: "assigned",
  RETURNED: "returned",
};

const ShiftStatus = {
  /** Vacant and available to claim; `staffId` is null. */
  OPEN: "open",
  SCHEDULED: "scheduled",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
};

/** How far an open shift is advertised for claiming. */
const ShiftVisibility = {
  BRANCH: "branch",
  ORGANIZATION: "organization",
};

const ShiftClaimStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
};

const CheckInMethod = {
  KIOSK: "kiosk",
  PHONE: "phone",
  MANUAL: "manual",
  QR: "qr",
  NFC: "nfc",
};

const PunctualityStatus = {
  ON_TIME: "onTime",
  LATE: "late",
};

const PresenceStatus = {
  ON_SITE: "onSite",
  CHECKED_OUT: "checkedOut",
  ON_BREAK: "onBreak",
  ON_LEAVE: "onLeave",
};

const ChangeRequestStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const AdmissionStatus = {
  ADMITTED: "admitted",
  DISCHARGED: "discharged",
};

const CareLevel = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

const PeepConsentStatus = {
  CONSENT: "consent",
  MCA_BI: "mcaBi",
};

const ExternalPersonType = {
  VISITOR: "visitor",
  CONTRACTOR: "contractor",
  PROFESSIONAL: "professional",
  GUEST: "guest",
};

const BadgeType = {
  GUEST: "guest",
  CONTRACTOR: "contractor",
  VIP: "vip",
};

const InvitationStatus = {
  PENDING: "pending",
  AWAITING_GUEST: "awaitingGuest",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CHECKED_IN: "checkedIn",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
};

const VisitSessionStatus = {
  AWAITING_APPROVAL: "awaitingApproval",
  ON_SITE: "onSite",
  CHECKED_OUT: "checkedOut",
  DENIED: "denied",
};

const VisitMethod = {
  INVITATION: "invitation",
  WALK_IN: "walkIn",
  QR: "qr",
  NFC: "nfc",
};

const KioskSetupStatus = {
  PENDING: "pending",
  REGISTERED: "registered",
};

const KioskMode = {
  LOCKED: "locked",
  SETUP: "setup",
};

const KioskDeviceType = {
  IPAD: "ipad",
  ANDROID: "android",
};

const KioskPairingStatus = {
  PENDING_CONFIRMATION: "pendingConfirmation",
  CONFIRMED: "confirmed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
};

const KioskWidgetType = {
  IMAGE: "image",
  QR: "qr",
  TEXT: "text",
  LINK: "link",
};

const KioskWidgetPlacement = {
  HOME: "home",
  CHECKOUT: "checkout",
};

/** Only used when type is text. */
const KioskTextKind = {
  QUOTE_OF_THE_DAY: "quoteOfTheDay",
  GREETING: "greeting",
  PLAIN: "plain",
};

const EvacuationType = {
  REAL: "real",
  MOCK: "mock",
};

const EvacuationStatus = {
  ACTIVE: "active",
  CLOSED: "closed",
};

const EvacPersonKind = {
  STAFF: "staff",
  RESIDENT: "resident",
  VISITOR: "visitor",
  CONTRACTOR: "contractor",
};

const EvacCheckStatus = {
  SAFE: "safe",
  MISSING: "missing",
  UNKNOWN: "unknown",
};

const DocumentScope = {
  ORG: "org",
  BRANCH: "branch",
  PERSONAL: "personal",
};

/** Subject filter on the documents list; distinct from `DocumentScope`, which is visibility. */
const DocumentCategory = {
  HEALTH_AND_SAFETY: "healthAndSafety",
  FIRE: "fire",
  CONTRACTORS: "contractors",
  POLICY: "policy",
  NEWSLETTER: "newsletter",
  OTHER: "other",
};

const ComplianceRecordStatus = {
  DUE: "due",
  COMPLETED: "completed",
  OVERDUE: "overdue",
  CANCELLED: "cancelled",
};

/** Stored on a supervision or appraisal row. Due and overdue are calculated. */
const ComplianceMeetingStatus = {
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

/** Only `annual` drives the appraisal due date and lock. */
const AppraisalKind = {
  ANNUAL: "annual",
  OTHER: "other",
};

const LeaveType = {
  ANNUAL: "annual",
  SICK: "sick",
  ABSENCE: "absence",
  UNPAID: "unpaid",
  COMPASSIONATE: "compassionate",
  PARENTAL: "parental",
  OTHER: "other",
};

const LeaveRequestStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  /** Settled and archived: taken, or recorded after the fact by a manager. */
  CLOSED: "closed",
};

/** Who raised the leave: the staff member, or a manager on their behalf. */
const LeaveRequestSource = {
  STAFF_REQUEST: "staffRequest",
  MANAGER_RECORDED: "managerRecorded",
};

const ResidentMediaType = {
  PHOTO: "photo",
  VIDEO: "video",
  DOCUMENT: "document",
};

const ResidentMediaReviewStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const VisitRequestStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
  CANCELLED: "cancelled",
};

const PersonCategoryAppliesTo = {
  VISITOR: "visitor",
  CONTRACTOR: "contractor",
  GUEST: "guest",
  ANY: "any",
};

module.exports = {
  MembershipRole,
  MembershipRoleRank,
  AppSurface,
  StaffInvitationStatus,
  AuthAudience,
  ModuleSlug,
  OrganizationStatus,
  BranchStatus,
  ActivationCodeStatus,
  ActiveInactiveStatus,
  StaffProfileStatus,
  JobTitleLevel,
  StaffAssetStatus,
  ShiftStatus,
  ShiftVisibility,
  ShiftClaimStatus,
  CheckInMethod,
  PunctualityStatus,
  PresenceStatus,
  ChangeRequestStatus,
  AdmissionStatus,
  CareLevel,
  PeepConsentStatus,
  ExternalPersonType,
  BadgeType,
  InvitationStatus,
  VisitSessionStatus,
  VisitMethod,
  KioskSetupStatus,
  KioskMode,
  KioskDeviceType,
  KioskPairingStatus,
  KioskWidgetType,
  KioskWidgetPlacement,
  KioskTextKind,
  EvacuationType,
  EvacuationStatus,
  EvacPersonKind,
  EvacCheckStatus,
  DocumentScope,
  DocumentCategory,
  ComplianceRecordStatus,
  ComplianceMeetingStatus,
  AppraisalKind,
  LeaveType,
  LeaveRequestStatus,
  LeaveRequestSource,
  ResidentMediaType,
  ResidentMediaReviewStatus,
  VisitRequestStatus,
  PersonCategoryAppliesTo,
};
