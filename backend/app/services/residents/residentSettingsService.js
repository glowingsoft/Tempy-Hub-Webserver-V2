const { Resident } = require("@models/Resident");
const { AppError } = require("@services/_errors/AppError");

const PREFERENCE_PATHS = {
  largeText: "appSettings.largeText",
  soundAlerts: "appSettings.soundAlerts",
};

const SETTING_KEYS = [...Object.keys(PREFERENCE_PATHS), "sharePhotos"];

const getSettings = async ({ resident }) => {
  const record = await Resident.findById(resident.residentId)
    .select("appSettings photographyConsent")
    .lean();

  return {
    largeText: record?.appSettings?.largeText ?? false,
    soundAlerts: record?.appSettings?.soundAlerts ?? true,
    sharePhotos: record?.photographyConsent === true,
  };
};

const parseSettings = (settings) => {
  const changes = SETTING_KEYS.filter(
    (key) => settings?.[key] !== undefined,
  ).map((key) => {
    if (typeof settings[key] !== "boolean") {
      throw new AppError("invalid_resident_setting", 400, { field: key });
    }
    return [key, settings[key]];
  });
  if (!changes.length) throw new AppError("nothing_to_update", 400);
  return Object.fromEntries(changes);
};

const updateSettings = async ({
  resident,
  userId,
  settings,
  now = new Date(),
}) => {
  const { sharePhotos, ...preferences } = parseSettings(settings);

  if (Object.keys(preferences).length) {
    await Resident.updateOne(
      { _id: resident.residentId },
      {
        $set: Object.fromEntries(
          Object.entries(preferences).map(([key, value]) => [
            PREFERENCE_PATHS[key],
            value,
          ]),
        ),
      },
    );
  }

  if (sharePhotos !== undefined) {
    await Resident.updateOne(
      {
        _id: resident.residentId,
        photographyConsent: sharePhotos ? { $ne: true } : true,
      },
      {
        $set: {
          photographyConsent: sharePhotos,
          photographyConsentCheckedAt: now,
          photographyConsentRecordedBy: userId,
          photoSharingStoppedAt: sharePhotos ? null : now,
        },
      },
    );
  }

  return getSettings({ resident });
};

module.exports = { getSettings, updateSettings };
