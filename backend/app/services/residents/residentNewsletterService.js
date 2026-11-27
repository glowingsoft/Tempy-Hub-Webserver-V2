const moment = require("moment-timezone");
const { Resident } = require("@models/Resident");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const { FamilyNewsletterStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("@appServices/family/familyPipeline");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const familyNewsletters = require("@appServices/family/familyNewsletterService");
const { loadSharing } = require("./residentFamilyService");

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

const getNewsletterScreen = async ({ resident, now = new Date() }) => {
  const sharing = await loadSharing(resident.residentId);
  const latest = isFamilyModuleActive(sharing.organization)
    ? await latestNewsletter({
        organizationId: sharing.organizationId,
        branchId: resident.branchId,
      })
    : null;
  if (!latest) throw new AppError("newsletter_not_found", 404);

  const newsletter = await familyNewsletters.getNewsletter({
    links: [
      {
        organizationId: sharing.organizationId,
        branchId: resident.branchId,
      },
    ],
    newsletterId: String(latest.newsletterId),
  });

  await Resident.updateOne(
    { _id: resident.residentId },
    { $set: { newsletterSeenAt: now } },
    { timestamps: false },
  );

  return newsletter;
};

module.exports = { latestNewsletter, getNewsletterScreen };
