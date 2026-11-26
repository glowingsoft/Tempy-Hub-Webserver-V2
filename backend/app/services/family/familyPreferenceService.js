const { User } = require("@models/UserModel");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("./familyPipeline");

const DEFAULTS = {
  newGazette: true,
  photoDecisions: true,
  gazetteReminders: true,
  visitChanges: true,
  newsletters: false,
  homeMessages: true,
  alsoByEmail: false,
};
const ALWAYS_ON = "emergencyAlerts";
const STORE = "notificationPreferences.familyApp";

const getPreferences = async ({ userId }) => {
  const [row] = await User.aggregate([
    { $match: { _id: toObjectId(userId) } },
    { $project: { name: 1, email: 1, profileIcon: 1, [STORE]: 1 } },
  ]);
  const stored = row?.notificationPreferences?.familyApp || {};

  return {
    profile: {
      name: row?.name || "",
      email: row?.email || "",
      profileIcon: row?.profileIcon || "",
    },
    ...Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, fallback]) => [
        key,
        stored[key] ?? fallback,
      ]),
    ),
    [ALWAYS_ON]: true,
  };
};

const updatePreferences = async ({ userId, body }) => {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("nothing_to_update", 400);

  const { [ALWAYS_ON]: emergency, ...changes } = body;
  if (emergency !== undefined && emergency !== true)
    throw new AppError("emergency_alerts_always_on", 400);

  const entries = Object.entries(changes);
  if (
    entries.some(
      ([key, value]) =>
        !Object.prototype.hasOwnProperty.call(DEFAULTS, key) ||
        typeof value !== "boolean",
    )
  )
    throw new AppError("invalid_notification_preference", 400);
  if (!entries.length) throw new AppError("nothing_to_update", 400);

  await User.updateOne(
    { _id: userId },
    {
      $set: Object.fromEntries(
        entries.map(([key, value]) => [`${STORE}.${key}`, value]),
      ),
    },
  );
  return getPreferences({ userId });
};

module.exports = { getPreferences, updatePreferences };
