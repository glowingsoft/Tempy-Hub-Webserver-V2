const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { AppError } = require("@services/_errors/AppError");
const {
  ModuleSlug,
  StaffDashboardCard,
  StaffProfileStatus,
} = require("@models/domainEnums");

const CARD_KEYS = Object.values(StaffDashboardCard);

const CARD_CATALOG = [
  {
    key: StaffDashboardCard.CHECK_IN,
    title: "Check In",
    description: "Today's Attendance Card with Check In / Break / Check Out.",
  },
  {
    key: StaffDashboardCard.PENDING_LEAVE,
    title: "Pending Leave",
    description: "Pending leave requests count card.",
  },
];

const defaultCards = () =>
  Object.fromEntries(CARD_KEYS.map((key) => [key, false]));

const presentCards = (stored = {}) => {
  const cards = defaultCards();
  for (const key of CARD_KEYS) {
    cards[key] = Boolean(stored[key]);
  }
  return cards;
};

const parseCards = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("cards_required", 400);
  }
  const unknown = Object.keys(input).filter((key) => !CARD_KEYS.includes(key));
  if (unknown.length) throw new AppError("invalid_staff_dashboard_card", 400);
  const cards = defaultCards();
  for (const key of CARD_KEYS) {
    if (input[key] !== undefined) cards[key] = Boolean(input[key]);
  }
  return cards;
};

const withCatalog = (cards) => ({
  cards,
  catalog: CARD_CATALOG.map((item) => ({
    ...item,
    showToStaff: cards[item.key],
  })),
});

const isModuleEnabled = (organization, moduleSlug) => {
  const entry = (organization.moduleAccess || []).find(
    (row) => row.moduleSlug === moduleSlug
  );
  return Boolean(
    entry?.enabled && (!entry.expiresAt || new Date(entry.expiresAt) > new Date())
  );
};

const loadOrganization = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("settings moduleAccess")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  return organization;
};

const getStaffDashboardSettings = async ({ organizationId }) => {
  const organization = await loadOrganization(organizationId);
  return withCatalog(presentCards(organization.settings?.staffDashboardCards));
};

const saveStaffDashboardSettings = async ({ organizationId, cards }) => {
  const next = parseCards(cards);
  const organization = await Organization.findByIdAndUpdate(
    organizationId,
    { $set: { "settings.staffDashboardCards": next } },
    { new: true, runValidators: true }
  )
    .select("settings")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  return withCatalog(presentCards(organization.settings?.staffDashboardCards));
};

const resetStaffDashboardSettings = async ({ organizationId }) =>
  saveStaffDashboardSettings({ organizationId, cards: defaultCards() });

const getStaffDashboardSettingsForStaff = async ({
  userId,
  organizationId,
}) => {
  const profile = await StaffProfile.findOne({
    userId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id branchId")
    .lean();
  if (!profile) throw new AppError("staff_profile_not_found", 403);

  const [organization, branch] = await Promise.all([
    loadOrganization(organizationId),
    profile.branchId
      ? Branch.findById(profile.branchId).select("settings").lean()
      : null,
  ]);

  const configured = presentCards(organization.settings?.staffDashboardCards);
  const attendanceOn = isModuleEnabled(
    organization,
    ModuleSlug.SIGN_IN_ATTENDANCE
  );
  const leaveOn = isModuleEnabled(organization, ModuleSlug.LEAVE);
  const allowPhoneCheckIn = Boolean(branch?.settings?.allowPhoneCheckIn);
  const enableLeaveRequests = branch?.settings?.enableLeaveRequests !== false;

  const cards = {
    [StaffDashboardCard.CHECK_IN]:
      configured.checkIn && attendanceOn && allowPhoneCheckIn,
    [StaffDashboardCard.PENDING_LEAVE]:
      configured.pendingLeave && leaveOn && enableLeaveRequests,
  };

  return {
    cards,
    visible: CARD_KEYS.filter((key) => cards[key]),
  };
};

module.exports = {
  CARD_KEYS,
  getStaffDashboardSettings,
  saveStaffDashboardSettings,
  resetStaffDashboardSettings,
  getStaffDashboardSettingsForStaff,
};
