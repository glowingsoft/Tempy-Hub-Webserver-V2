const { Resident } = require("@models/Resident");
const { AppError } = require("@services/_errors/AppError");
const { resolveFamilyResidents } = require("./familyAccessService");
const { nextGazette } = require("./familyGazetteService");
const { toObjectId } = require("./familyPipeline");

const LIMITS = {
  maxMessageLength: 500,
  maxPhotos: 10,
  maxPhotoSizeMb: 10,
  maxTotalSizeMb: 50,
};

/** Everything the New Upload screen shows before anything is sent. */
const getNewUpload = async ({ userId, link }) => {
  const [residents, [consent], gazette] = await Promise.all([
    resolveFamilyResidents(userId, {
      activeResidentId: String(link.residentId),
    }),
    Resident.aggregate([
      { $match: { _id: toObjectId(link.residentId) } },
      { $project: { photographyConsent: 1 } },
    ]),
    nextGazette({ link }),
  ]);
  const resident = residents.find(
    (row) => String(row.residentId) === String(link.residentId),
  );
  if (!resident) throw new AppError("resident_not_found", 404);

  return {
    resident: {
      residentId: resident.residentId,
      residentName: resident.residentName,
      residentPhotoUrl: resident.residentPhotoUrl,
      homeName: resident.homeName,
    },
    // false: only a text message can be sent
    photoSharing: consent?.photographyConsent === true,
    nextGazette: gazette,
    limits: LIMITS,
  };
};

module.exports = { getNewUpload };
