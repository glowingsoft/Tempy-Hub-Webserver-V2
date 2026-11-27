const { Resident } = require("@models/Resident");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, joinOne, personFields } = require("@appServices/family/familyPipeline");
const {
  isFamilyModuleActive,
  listRelationships,
} = require("@appServices/family/familyAccessService");
const { loadSharing } = require("./residentFamilyService");

const SETTING_PATHS = {
  largeText: "appSettings.largeText",
  soundAlerts: "appSettings.soundAlerts",
  sharePhotos: "photographyConsent",
};

const familyContactOf = async (residentId) => {
  const [contact] = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        status: FamilyMemberStatus.ACTIVE,
        isNextOfKin: true,
      },
    },
    { $sort: { createdAt: 1, _id: 1 } },
    { $limit: 1 },
    ...joinOne({ from: User, localField: "userId", as: "user" }),
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        ...personFields(),
        relationship: 1,
      },
    },
  ]);
  if (!contact) return null;

  const relationship = String(
    listRelationships().find((option) => option.value === contact.relationship)
      ?.label || "",
  ).toLowerCase();
  return {
    ...contact,
    label: relationship ? `${contact.name} (${relationship})` : contact.name,
  };
};

const getProfileScreen = async ({ resident }) => {
  const [sharing, record] = await Promise.all([
    loadSharing(resident.residentId),
    Resident.findById(resident.residentId)
      .select("appSettings photographyConsent")
      .lean(),
  ]);
  const familyContact = isFamilyModuleActive(sharing.organization)
    ? await familyContactOf(resident.residentId)
    : null;

  return {
    resident: {
      residentId: resident.residentId,
      name: resident.name,
      photoUrl: resident.photoUrl,
      homeName: resident.branchName,
      roomNumber: resident.roomNumber,
      subtitle: [
        resident.branchName,
        resident.roomNumber ? `Room ${resident.roomNumber}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    },
    details: {
      familyContact,
    },
    settings: {
      largeText: record?.appSettings?.largeText ?? false,
      soundAlerts: record?.appSettings?.soundAlerts ?? true,
      sharePhotos: record?.photographyConsent === true,
    },
  };
};

const parseSettings = (settings) => {
  const changes = Object.keys(SETTING_PATHS)
    .filter((key) => settings?.[key] !== undefined)
    .map((key) => {
      if (typeof settings[key] !== "boolean") {
        throw new AppError("invalid_resident_setting", 400, { field: key });
      }
      return [key, settings[key]];
    });
  if (!changes.length) throw new AppError("nothing_to_update", 400);
  return Object.fromEntries(changes);
};

const updateProfileSettings = async ({
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
            SETTING_PATHS[key],
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

  return getProfileScreen({ resident });
};

module.exports = { getProfileScreen, updateProfileSettings };
