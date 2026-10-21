const { Organization } = require("@models/Organization");
const { StaffProfile } = require("@models/StaffProfile");
const { AppError } = require("@services/_errors/AppError");
const { StaffProfileStatus } = require("@models/domainEnums");

const DEFAULT_SUPERVISION_MONTHS = 3;
const DEFAULT_APPRAISAL_MONTHS = 12;

const parseInterval = (value, max, key) => {
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > max) {
    throw new AppError(key, 400);
  }
  return months;
};

const parseSupervisionInterval = (value) =>
  parseInterval(value, 12, "invalid_supervision_interval");

const parseAppraisalInterval = (value) =>
  parseInterval(value, 24, "invalid_appraisal_interval");

const orgCycleDefaults = (settings = {}) => ({
  supervisionMonths:
    settings.defaultSupervisionIntervalMonths || DEFAULT_SUPERVISION_MONTHS,
  appraisalMonths:
    settings.defaultAppraisalIntervalMonths || DEFAULT_APPRAISAL_MONTHS,
});

const effectiveIntervals = (staff, settings) => {
  const defaults = orgCycleDefaults(settings);
  return {
    supervisionMonths: staff.supervisionIntervalMonths || defaults.supervisionMonths,
    appraisalMonths: staff.appraisalIntervalMonths || defaults.appraisalMonths,
  };
};

const assertAppraisalAfterSupervision = (appraisalMonths, supervisionMonths) => {
  if (appraisalMonths <= supervisionMonths) {
    throw new AppError("appraisal_interval_conflicts_with_supervision", 400);
  }
};

const loadOrgCycleSettings = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("settings.defaultSupervisionIntervalMonths settings.defaultAppraisalIntervalMonths")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  return organization.settings || {};
};

const assertNoStaffCycleConflict = async ({
  organizationId,
  appraisalDefault,
  supervisionDefault,
}) => {
  assertAppraisalAfterSupervision(appraisalDefault, supervisionDefault);

  const clash = await StaffProfile.exists({
    organizationId,
    status: StaffProfileStatus.ACTIVE,
    $expr: {
      $lte: [
        { $ifNull: ["$appraisalIntervalMonths", appraisalDefault] },
        { $ifNull: ["$supervisionIntervalMonths", supervisionDefault] },
      ],
    },
  });
  if (clash) throw new AppError("appraisal_interval_conflicts_with_supervision", 400);
};

module.exports = {
  DEFAULT_SUPERVISION_MONTHS,
  DEFAULT_APPRAISAL_MONTHS,
  parseSupervisionInterval,
  parseAppraisalInterval,
  orgCycleDefaults,
  effectiveIntervals,
  assertAppraisalAfterSupervision,
  loadOrgCycleSettings,
  assertNoStaffCycleConflict,
};
