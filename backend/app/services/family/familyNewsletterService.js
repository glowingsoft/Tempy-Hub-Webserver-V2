const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const { FamilyNewsletterStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const adminNewsletters = require("@adminServices/family/familyNewsletterService");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");

const SUMMARY_LENGTH = 140;

const periodLabelOf = (month) => moment.utc(`${month}-01`).format("MMMM YYYY");

/** Families see a newsletter once it has been sent into the app, and only for the home they are linked to. */
const inAppSent = (extra = {}) => ({
  ...extra,
  status: FamilyNewsletterStatus.SENT,
  "delivery.inApp": true,
});

const cut = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Current and past issues of the home, newest first. */
const listNewsletters = async ({ link, page, limit, skip }) => {
  const { data, meta } = await paginateWithFacet({
    model: FamilyNewsletter,
    match: inAppSent({
      organizationId: toObjectId(link.organizationId),
      branchId: toObjectId(link.branchId),
    }),
    page,
    limit,
    skip,
    sort: { sentAt: -1, _id: -1 },
    extraDataStages: [
      ...joinOne({
        from: Branch,
        localField: "branchId",
        as: "branch",
        optional: true,
      }),
      {
        $project: {
          _id: 0,
          newsletterId: "$_id",
          homeName: { $ifNull: ["$branch.name", ""] },
          title: 1,
          month: 1,
          issueNumber: 1,
          sentAt: 1,
          editedAt: "$updatedAt",
          welcome: { $cond: ["$sections.welcome", "$welcome.text", ""] },
        },
      },
    ],
  });

  return {
    data: data.map(({ welcome, ...row }) => ({
      ...row,
      periodLabel: periodLabelOf(row.month),
      summary: cut(String(welcome || "").trim(), SUMMARY_LENGTH),
    })),
    meta,
  };
};

/** A newsletter the caller's links reach: sent into the app, from a home they belong to. Anything else is "not found". */
const loadVisible = async ({ links, newsletterId }) => {
  if (!isValidObjectId(newsletterId))
    throw new AppError("newsletter_not_found", 404);

  const [newsletter] = await FamilyNewsletter.aggregate([
    { $match: inAppSent({ _id: toObjectId(newsletterId) }) },
  ]);
  const visible =
    newsletter &&
    links.some(
      (link) =>
        String(link.organizationId) === String(newsletter.organizationId) &&
        String(link.branchId) === String(newsletter.branchId),
    );
  if (!visible) throw new AppError("newsletter_not_found", 404);
  return newsletter;
};

/**
 * The reader: only the sections that were switched on. What a resident's photo-sharing choice or a
 * removed post has changed since sending is left out on every read (BR-06).
 */
const getNewsletter = async ({ links, newsletterId }) => {
  const newsletter = await loadVisible({ links, newsletterId });
  const content = await adminNewsletters.pruneForSend(newsletter);
  const on = newsletter.sections;

  const mediaIds = [
    ...content.highlights.map((item) => item.mediaId),
    ...content.gallery.map((item) => item.mediaId),
  ].filter(Boolean);
  const media = mediaIds.length
    ? await FamilyMedia.aggregate([
        { $match: { _id: { $in: mediaIds } } },
        { $project: { url: 1 } },
      ])
    : [];
  const urlOf = new Map(media.map((item) => [String(item._id), item.url]));
  const photoUrl = (id) => (id ? urlOf.get(String(id)) || "" : "");

  const [branch] = await Branch.aggregate([
    { $match: { _id: newsletter.branchId } },
    { $project: { name: 1 } },
  ]);

  return {
    newsletterId: newsletter._id,
    homeName: branch?.name || "",
    title: newsletter.title,
    month: newsletter.month,
    periodLabel: periodLabelOf(newsletter.month),
    issueNumber: newsletter.issueNumber,
    sentAt: newsletter.sentAt,
    editedAt: newsletter.updatedAt,
    welcome:
      on.welcome && newsletter.welcome.text
        ? {
            text: newsletter.welcome.text,
            signedBy: newsletter.welcome.signedBy,
          }
        : null,
    highlights: on.highlights
      ? content.highlights.map((item) => ({
          title: item.title,
          text: item.text,
          photoUrl: photoUrl(item.mediaId),
          postedAt: item.postedAt,
        }))
      : [],
    comingUp: on.comingUp ? newsletter.comingUp : [],
    notices: on.notices ? newsletter.notices : [],
    newResidents: on.newResidents
      ? content.newResidents.map((item) => ({
          name: item.name,
          roomNumber: item.roomNumber,
        }))
      : [],
    gallery: on.gallery
      ? content.gallery.map((item) => ({
          url: photoUrl(item.mediaId),
          caption: item.caption,
        }))
      : [],
    footer: newsletter.footer,
  };
};

/** The same PDF the home emailed: the stored copy, or drawn from what was sent when none was stored. */
const getPdf = async ({ links, newsletterId }) => {
  const newsletter = await loadVisible({ links, newsletterId });
  return adminNewsletters.getPdf({
    organizationId: newsletter.organizationId,
    newsletterId,
  });
};

module.exports = { listNewsletters, getNewsletter, getPdf };
