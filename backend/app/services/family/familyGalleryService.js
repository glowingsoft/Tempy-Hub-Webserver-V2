const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyUploadStatus, FamilyPostStatus } = require("@models/domainEnums");
const { facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, joinOne } = require("./familyPipeline");

const GalleryTab = { ALL: "all", THIS_MONTH: "thisMonth", FROM_ME: "fromMe" };
const GallerySource = { UPLOAD: "upload", WALL_POST: "wallPost" };

const DEFAULT_TIMEZONE = "Europe/London";

const hasBlurredCopy = {
  $gt: [{ $strLenCP: { $ifNull: ["$media.blurredUrl", ""] } }, 0],
};

const tileStages = ({ userId }) => [
  { $unwind: "$mediaIds" },
  {
    $lookup: {
      from: FamilyMedia.collection.name,
      localField: "mediaIds",
      foreignField: "_id",
      as: "media",
    },
  },
  { $unwind: "$media" },
  {
    $project: {
      _id: 0,
      mediaId: "$media._id",
      url: { $cond: [hasBlurredCopy, "$media.blurredUrl", "$media.url"] },
      width: { $ifNull: ["$media.width", 0] },
      height: { $ifNull: ["$media.height", 0] },
      source: "$kind",
      uploadId: {
        $cond: [{ $eq: ["$kind", GallerySource.UPLOAD] }, "$_id", null],
      },
      postId: {
        $cond: [{ $eq: ["$kind", GallerySource.WALL_POST] }, "$_id", null],
      },
      takenAt: "$sortAt",
      fromMe: {
        $and: [
          { $eq: ["$kind", GallerySource.UPLOAD] },
          { $eq: ["$authorId", toObjectId(userId)] },
        ],
      },
    },
  },
];

const tabMatch = ({ tab, month }) => {
  if (tab === GalleryTab.THIS_MONTH)
    return [{ $match: { takenAt: { $gte: month.from, $lte: month.to } } }];
  if (tab === GalleryTab.FROM_ME) return [{ $match: { fromMe: true } }];
  return [];
};

const emptyCounts = { all: 0, thisMonth: 0, fromMe: 0 };

/**
 * The photos of one resident: approved family uploads and published wall posts that tag them, one tile per
 * photo, newest first. Photo sharing is read on every request (BR-06), so a resident who switches it off
 * has no photos here from that moment. `link` is the caller's active link, so a removed member sees nothing.
 */
const listGallery = async ({
  link,
  userId,
  tab = GalleryTab.ALL,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  if (!Object.values(GalleryTab).includes(tab))
    throw new AppError("invalid_gallery_tab", 400);

  const residentId = toObjectId(link.residentId);
  const [resident] = await Resident.aggregate([
    {
      $match: {
        _id: residentId,
        organizationId: toObjectId(link.organizationId),
      },
    },
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    { $project: { photographyConsent: 1, timezone: "$branch.timezone" } },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);

  if (resident.photographyConsent !== true) {
    return {
      data: [],
      meta: {
        ...generateMeta(page, limit, 0),
        counts: emptyCounts,
        photoSharing: false,
      },
    };
  }

  const zone = moment.tz(now, resident.timezone || DEFAULT_TIMEZONE);
  const month = {
    from: zone.clone().startOf("month").toDate(),
    to: zone.clone().endOf("month").toDate(),
  };

  const [result] = await FamilyUpload.aggregate([
    {
      $match: {
        residentId,
        organizationId: toObjectId(link.organizationId),
        status: FamilyUploadStatus.APPROVED,
      },
    },
    {
      $project: {
        kind: { $literal: GallerySource.UPLOAD },
        sortAt: "$decidedAt",
        authorId: 1,
        mediaIds: 1,
      },
    },
    {
      $unionWith: {
        coll: FamilyPost.collection.name,
        pipeline: [
          {
            $match: {
              organizationId: toObjectId(link.organizationId),
              taggedResidentIds: residentId,
              status: FamilyPostStatus.PUBLISHED,
            },
          },
          {
            $project: {
              kind: { $literal: GallerySource.WALL_POST },
              sortAt: "$createdAt",
              authorId: 1,
              mediaIds: 1,
            },
          },
        ],
      },
    },
    ...tileStages({ userId }),
    {
      $facet: {
        data: [
          ...tabMatch({ tab, month }),
          { $sort: { takenAt: -1, mediaId: -1 } },
          { $skip: skip },
          { $limit: limit },
        ],
        total: [...tabMatch({ tab, month }), { $count: "count" }],
        all: [{ $count: "count" }],
        thisMonth: [
          ...tabMatch({ tab: GalleryTab.THIS_MONTH, month }),
          { $count: "count" },
        ],
        fromMe: [
          ...tabMatch({ tab: GalleryTab.FROM_ME, month }),
          { $count: "count" },
        ],
      },
    },
  ]);

  return {
    data: result.data,
    meta: {
      ...generateMeta(page, limit, facetCount(result.total)),
      counts: {
        all: facetCount(result.all),
        thisMonth: facetCount(result.thisMonth),
        fromMe: facetCount(result.fromMe),
      },
      photoSharing: true,
    },
  };
};

module.exports = { listGallery, GalleryTab };
