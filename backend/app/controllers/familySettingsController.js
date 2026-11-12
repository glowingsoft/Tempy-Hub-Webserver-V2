const { respond } = require("@utils/controllerResponse");
const { queryId } = require("@utils/familyQuery");
const { AppError } = require("@services/_errors/AppError");
const { Organization } = require("@models/Organization");
const { toObjectId } = require("@appServices/family/familyPipeline");
const settingsOverviewService = require("@adminServices/settings/settingsOverviewService");
const familySettingsService = require("@adminServices/family/familySettingsService");

const contextOf = (req) => ({
  actor: req.user,
  role: req.membership?.role,
  permissions: req.membership?.permissions,
  organization: req.organization,
  organizationId: req.orgId,
});

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getSettings = respond(async (req) => {
  const { visits, access } = await settingsOverviewService.getAll({
    ...contextOf(req),
    branchId: queryId(req.query.branchId, "branchId"),
  });
  const [family, [organization]] = await Promise.all([
    familySettingsService.getSettings({ organizationId: req.orgId }),
    Organization.aggregate([
      { $match: { _id: toObjectId(req.orgId) } },
      {
        $project: {
          emergencyNotifyOffsite: {
            $ifNull: ["$settings.emergencyNotifyOffsite", false],
          },
        },
      },
    ]),
  ]);
  return {
    access: { editVisiting: Boolean(access.visits), editGazette: Boolean(access.family) },
    gazette: {
      issueEveryDays: family.gazette.issueEveryDays,
      messageCap: family.gazette.messageCap,
      anchorDate: family.gazette.anchorDate,
      deadlineReminder: family.deadlineReminder,
      communityWall: family.communityWall,
      configured: family.configured,
    },
    visiting: visits ? { ...visits, bookingOpen: !visits.paused } : null,
    safety: {
      emergencyNotifyOffsite: Boolean(organization?.emergencyNotifyOffsite),
    },
  };
});

const toAdminBody = (body, queryBranchId) => {
  const { gazette, visiting } = body || {};
  if (gazette !== undefined && !isObject(gazette))
    throw new AppError("invalid_settings_section", 400, { section: "gazette" });
  if (visiting !== undefined && !isObject(visiting))
    throw new AppError("invalid_settings_section", 400, { section: "visiting" });

  const result = {};
  if (gazette) {
    const { deadlineReminder, communityWall, ...schedule } = gazette;
    delete schedule.configured;
    result.family = {
      deadlineReminder,
      communityWall,
      ...(Object.keys(schedule).length ? { gazette: schedule } : {}),
    };
  }
  if (visiting) {
    const { bookingOpen, ...rules } = visiting;
    delete rules.paused;
    result.visits = {
      ...rules,
      branchId: visiting.branchId ?? queryBranchId,
      ...(bookingOpen !== undefined
        ? {
            paused:
              typeof bookingOpen === "boolean" ? !bookingOpen : bookingOpen,
          }
        : {}),
    };
  }
  return result;
};

const updateSettings = respond(
  (req) =>
    settingsOverviewService.updateAll({
      ...contextOf(req),
      body: toAdminBody(req.body, req.query.branchId),
    }),
  { translationKey: "settings_saved" },
);

module.exports = { getSettings, updateSettings };
