const moment = require("moment-timezone");
const { FamilySettings } = require("@models/FamilySettings");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("@appServices/family/familyPipeline");

const DEFAULTS = { issueEveryDays: 14, messageCap: 30, anchorDate: null };
const LIMITS = { issueEveryDays: { min: 1, max: 90 }, messageCap: { min: 1, max: 100 } };
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const present = (row) => ({
  configured: Boolean(row),
  gazette: {
    issueEveryDays: row?.gazette?.issueEveryDays ?? DEFAULTS.issueEveryDays,
    messageCap: row?.gazette?.messageCap ?? DEFAULTS.messageCap,
    anchorDate: row?.gazette?.anchorDate ? moment.utc(row.gazette.anchorDate).format("YYYY-MM-DD") : null,
  },
  updatedAt: row?.updatedAt ?? null,
});

const getSettings = async ({ organizationId }) => {
  const [row] = await FamilySettings.aggregate([{ $match: { organizationId: toObjectId(organizationId) } }]);
  return present(row);
};

/** For the gazette engine: the same values as above, as the dates and numbers it works with. */
const getGazetteRules = async ({ organizationId }) => {
  const settings = await getSettings({ organizationId });
  return {
    configured: settings.configured,
    issueEveryDays: settings.gazette.issueEveryDays,
    messageCap: settings.gazette.messageCap,
    anchorDate: settings.gazette.anchorDate,
  };
};

const wholeNumber = (value, field) => {
  const { min, max } = LIMITS[field];
  if (!Number.isInteger(value) || value < min || value > max) throw new AppError("gazette_setting_invalid", 400, { field, min, max });
  return value;
};

/**
 * Only what is sent changes. Saving is what switches the schedule on, so the first save also needs a start
 * day: the first issue begins on it.
 */
const updateSettings = async ({ actor, organizationId, gazette }) => {
  if (!gazette || typeof gazette !== "object" || Array.isArray(gazette)) throw new AppError("gazette_setting_invalid", 400, { field: "gazette", min: "", max: "" });

  const set = {};
  if (gazette.issueEveryDays !== undefined) set["gazette.issueEveryDays"] = wholeNumber(gazette.issueEveryDays, "issueEveryDays");
  if (gazette.messageCap !== undefined) set["gazette.messageCap"] = wholeNumber(gazette.messageCap, "messageCap");
  if (gazette.anchorDate !== undefined) {
    const day = typeof gazette.anchorDate === "string" && DATE_ONLY.test(gazette.anchorDate) ? moment.utc(gazette.anchorDate, "YYYY-MM-DD", true) : null;
    if (!day || !day.isValid()) throw new AppError("gazette_anchor_invalid", 400);
    set["gazette.anchorDate"] = day.toDate();
  }
  if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);

  const existing = await getSettings({ organizationId });
  if (!existing.configured && !set["gazette.anchorDate"]) throw new AppError("gazette_anchor_required", 400);

  await FamilySettings.updateOne(
    { organizationId: toObjectId(organizationId) },
    { $set: { ...set, updatedBy: actor._id }, $setOnInsert: { organizationId: toObjectId(organizationId) } },
    { upsert: true }
  );
  return getSettings({ organizationId });
};

module.exports = { getSettings, getGazetteRules, updateSettings, DEFAULTS };
