const { Resident } = require("@models/Resident");
const { hasSharedPhotos } = require("@utils/photoSharing");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const { latestNewsletter } = require("./residentNewsletterService");
const {
  loadSharing,
  countNewPhotos,
} = require("./residentFamilyService");

const homeStatus = (resident) => {
  const isOut = Boolean(resident?.isOut);
  return {
    isOut,
    label: isOut ? "You are out of the home" : "You are in the home",
    destination: isOut ? resident.outDestination || "" : "",
    since: isOut ? resident.outSince || null : null,
    expectedReturnAt: isOut ? resident.expectedReturnAt || null : null,
  };
};

const getHomeScreen = async ({ resident }) => {
  const [sharing, record, evacuation] = await Promise.all([
    loadSharing(resident.residentId),
    Resident.findById(resident.residentId)
      .select("isOut outDestination outSince expectedReturnAt newsletterSeenAt")
      .lean(),
    evacuationService.getResidentEvacuation({ resident }),
  ]);
  const familyActive = isFamilyModuleActive(sharing.organization);
  const photosVisible = familyActive && hasSharedPhotos(sharing);

  const [newCount, newsletter] = await Promise.all([
    photosVisible
      ? countNewPhotos({
          residentId: resident.residentId,
          organizationId: sharing.organizationId,
          sharing,
        })
      : 0,
    familyActive
      ? latestNewsletter({
          organizationId: sharing.organizationId,
          branchId: resident.branchId,
          seenAt: record?.newsletterSeenAt,
        })
      : null,
  ]);

  return {
    resident: {
      name: resident.name,
      photoUrl: resident.photoUrl,
      homeName: resident.branchName,
    },
    status: homeStatus(record),
    photos: { newCount },
    newsletter,
    evacuation,
  };
};

module.exports = { getHomeScreen };
