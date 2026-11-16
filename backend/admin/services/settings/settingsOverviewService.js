const { MembershipRole } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { Organization } = require("@models/Organization");
const { toObjectId } = require("@appServices/family/familyPipeline");
const {
  FAMILY_VIEW,
  FAMILY_MANAGE,
  FAMILY_STAFF_ROLES,
} = require("@adminServices/family/familyAccess");
const { isFamilyModuleActive } = require("@appServices/family/familyAccessService");
const familySettingsService = require("@adminServices/family/familySettingsService");
const familyVisitStaffService = require("@adminServices/family/familyVisitStaffService");
const billingUsageService = require("@adminServices/billing/billingUsageService");

const ORG_ADMINS = [MembershipRole.OWNER, MembershipRole.SUPER_ADMIN];
const SECTIONS = ["billing", "family", "visits"];

const accessOf = ({ actor, role, permissions = [], organization, organizationId }, permission) => {
  const platform = actor?.userType === "admin";
  const allowed = platform || ORG_ADMINS.includes(role) || permissions.includes(permission);
  const familyOn = Boolean(organizationId) && (platform || isFamilyModuleActive(organization));
  return {
    billing: platform,
    family: familyOn && allowed && (platform || ORG_ADMINS.includes(role)),
    visits: familyOn && allowed && (platform || FAMILY_STAFF_ROLES.includes(role)),
  };
};

const getAll = async (context) => {
  const { actor, organizationId, branchId } = context;
  const access = accessOf(context, FAMILY_VIEW);
  const result = { access };

  if (access.billing) result.billing = await billingUsageService.getSettings({ actor });
  if (access.family) result.family = await familySettingsService.getSettings({ organizationId });
  if (access.visits) {
    try {
      result.visits = await familyVisitStaffService.getSettings({ actor, organizationId, branchId });
    } catch (error) {
      if (error.message !== "branch_required") throw error;
      result.visits = null;
    }
  }
  return result;
};

const updateAll = async (context) => {
  const { actor, organizationId, body = {} } = context;
  const sent = SECTIONS.filter((section) => body[section] !== undefined);
  if (!sent.length) throw new AppError("nothing_to_update", 400);
  sent.forEach((section) => {
    const value = body[section];
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new AppError("invalid_settings_section", 400, { section });
  });

  const access = accessOf(context, FAMILY_MANAGE);
  sent.forEach((section) => {
    if (!access[section]) throw new AppError("insufficient_role", 403);
  });

  const saved = {};
  if (sent.includes("billing"))
    saved.billing = await billingUsageService.updateSettings({ actor, ...body.billing });
  if (sent.includes("family"))
    saved.family = await familySettingsService.updateSettings({
      actor,
      organizationId,
      gazette: body.family.gazette,
      deadlineReminder: body.family.deadlineReminder,
      communityWall: body.family.communityWall,
    });
  if (sent.includes("visits"))
    saved.visits = await familyVisitStaffService.updateSettings({
      actor,
      organizationId,
      branchId: body.visits.branchId,
      body: body.visits,
    });
  return saved;
};

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const loadEmergencyNotifyOffsite = async (organizationId) => {
  const [row] = await Organization.aggregate([
    { $match: { _id: toObjectId(organizationId) } },
    { $project: { value: { $ifNull: ["$settings.emergencyNotifyOffsite", false] } } },
  ]);
  return Boolean(row?.value);
};

/** The Family Settings screen of the manager app: gazette and safety are read-only unless the caller is an org admin. */
const getFamilyScreen = async (context) => {
  const { organizationId } = context;
  const [{ visits, access }, family, emergencyNotifyOffsite] = await Promise.all([
    getAll(context),
    familySettingsService.getSettings({ organizationId }),
    loadEmergencyNotifyOffsite(organizationId),
  ]);
  return {
    access: { editVisiting: Boolean(access.visits), editGazette: Boolean(access.family) },
    gazette: {
      issueEveryDays: family.gazette.issueEveryDays,
      messageCap: family.gazette.messageCap,
      deadlineReminder: family.deadlineReminder,
      communityWall: family.communityWall,
    },
    visiting: visits && {
      bookingOpen: !visits.paused,
      loungeCapacityPerSlot: visits.loungeCapacityPerSlot,
      protectedTimes: visits.protectedTimes,
    },
    safety: { emergencyNotifyOffsite },
  };
};

const updateFamilyScreen = async (context) => {
  const { body, branchId } = context;
  const { gazette, visiting } = body || {};
  [["gazette", gazette], ["visiting", visiting]].forEach(([section, value]) => {
    if (value !== undefined && !isObject(value))
      throw new AppError("invalid_settings_section", 400, { section });
  });

  const sections = {};
  if (gazette) {
    const { deadlineReminder, communityWall, configured, ...schedule } = gazette;
    sections.family = {
      deadlineReminder,
      communityWall,
      ...(Object.keys(schedule).length ? { gazette: schedule } : {}),
    };
  }
  if (visiting) {
    const { bookingOpen, paused, ...rules } = visiting;
    sections.visits = {
      ...rules,
      branchId: rules.branchId ?? branchId,
      ...(bookingOpen !== undefined
        ? { paused: typeof bookingOpen === "boolean" ? !bookingOpen : bookingOpen }
        : {}),
    };
  }
  return updateAll({ ...context, body: sections });
};

module.exports = { getAll, updateAll, getFamilyScreen, updateFamilyScreen };
