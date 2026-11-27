const moment = require("moment-timezone");
const { Resident } = require("@models/Resident");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const { FamilyNewsletterStatus } = require("@models/domainEnums");
const { toObjectId } = require("@appServices/family/familyPipeline");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const evacuationService = require("@adminServices/evacuation/evacuationService");
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

const latestNewsletter = async ({ organizationId, branchId, seenAt }) => {
  const [newsletter] = await FamilyNewsletter.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        status: FamilyNewsletterStatus.SENT,
        "delivery.inApp": true,
      },
    },
    { $sort: { sentAt: -1, _id: -1 } },
    { $limit: 1 },
    { $project: { title: 1, month: 1, issueNumber: 1, sentAt: 1 } },
  ]);
  if (!newsletter) return null;

  const month = moment.utc(`${newsletter.month}-01`).format("MMMM");
  return {
    newsletterId: newsletter._id,
    title: newsletter.title,
    month: newsletter.month,
    issueNumber: newsletter.issueNumber,
    sentAt: newsletter.sentAt,
    subtitle: [newsletter.title, month].filter(Boolean).join(" · "),
    isNew: !seenAt || newsletter.sentAt > seenAt,
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
  const photoSharing = familyActive && sharing.photographyConsent === true;

  const [newCount, newsletter] = await Promise.all([
    photoSharing
      ? countNewPhotos({
          residentId: resident.residentId,
          organizationId: sharing.organizationId,
          seenAt: sharing.photosSeenAt,
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
