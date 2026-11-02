const { MembershipRole } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
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

module.exports = { getAll, updateAll };
