const { Resident } = require("@models/Resident");
const { User } = require("@models/UserModel");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyUploadStatus, FamilyPostStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
} = require("@appServices/family/familyPipeline");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const { loadSharing } = require("./residentFamilyService");

const PhotoTab = { ALL: "all", FAMILY: "family", HOME: "home" };

const SUBTITLE = "Pictures your family and carers have shared with you.";

const parseTab = (value) => {
  const tab = String(value || PhotoTab.ALL)
    .trim()
    .toLowerCase();
  if (!Object.values(PhotoTab).includes(tab)) {
    throw new AppError("invalid_gallery_tab", 400);
  }
  return tab;
};

const firstName = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)[0];

const textOf = (field) => ({ $ifNull: [field, ""] });

const familyPhotoStages = ({ residentId, organizationId }) => [
  {
    $match: {
      residentId,
      organizationId,
      status: FamilyUploadStatus.APPROVED,
    },
  },
  {
    $project: {
      source: { $literal: PhotoTab.FAMILY },
      sortAt: "$decidedAt",
      authorId: 1,
      mediaIds: 1,
      title: textOf("$message"),
    },
  },
];

const homePhotoStages = ({ residentId, organizationId }) => [
  {
    $match: {
      organizationId,
      taggedResidentIds: residentId,
      status: FamilyPostStatus.PUBLISHED,
    },
  },
  {
    $project: {
      source: { $literal: PhotoTab.HOME },
      sortAt: "$createdAt",
      authorId: 1,
      mediaIds: 1,
      title: {
        $cond: [
          { $gt: [{ $strLenCP: textOf("$title") }, 0] },
          "$title",
          textOf("$message"),
        ],
      },
    },
  },
];

const photoStages = ({ scope, tab }) => [
  ...familyPhotoStages(scope),
  {
    $unionWith: {
      coll: FamilyPost.collection.name,
      pipeline: homePhotoStages(scope),
    },
  },
  ...(tab === PhotoTab.ALL ? [] : [{ $match: { source: tab } }]),
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
];

const newestFirst = { $sort: { sortAt: -1, "media._id": -1 } };

const tileStages = [
  ...joinOne({
    from: User,
    localField: "authorId",
    as: "author",
    optional: true,
  }),
  {
    $project: {
      _id: 0,
      mediaId: "$media._id",
      url: {
        $cond: [
          { $gt: [{ $strLenCP: textOf("$media.blurredUrl") }, 0] },
          "$media.blurredUrl",
          "$media.url",
        ],
      },
      width: { $ifNull: ["$media.width", 0] },
      height: { $ifNull: ["$media.height", 0] },
      source: 1,
      title: 1,
      authorName: textOf("$author.name"),
      sharedAt: "$sortAt",
    },
  },
];

const toPhoto = ({ authorName, ...photo }, resident) => ({
  ...photo,
  fromName: firstName(authorName) || resident.branchName,
});

const loadPhotoAccess = async (resident) => {
  const sharing = await loadSharing(resident.residentId);
  return {
    photoSharing:
      isFamilyModuleActive(sharing.organization) &&
      sharing.photographyConsent === true,
    scope: {
      residentId: toObjectId(resident.residentId),
      organizationId: toObjectId(sharing.organizationId),
    },
  };
};

const listPhotos = async ({ scope, tab, page, limit, skip }) => {
  const [result] = await FamilyUpload.aggregate([
    ...photoStages({ scope, tab }),
    {
      $facet: {
        data: [newestFirst, { $skip: skip }, { $limit: limit }, ...tileStages],
        total: [{ $count: "count" }],
      },
    },
  ]);

  return {
    photos: result.data,
    total: facetCount(result.total),
    page,
    limit,
  };
};

const getPhotosScreen = async ({
  resident,
  tab: requestedTab,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const tab = parseTab(requestedTab);
  const { photoSharing, scope } = await loadPhotoAccess(resident);

  const { photos, total } = photoSharing
    ? await listPhotos({ scope, tab, page, limit, skip })
    : { photos: [], total: 0 };

  if (photoSharing && page === 1) {
    await Resident.updateOne(
      { _id: resident.residentId },
      { $set: { photosSeenAt: now } },
      { timestamps: false },
    );
  }

  return {
    data: {
      subtitle: SUBTITLE,
      photoSharing,
      tab,
      tabs: [
        { key: PhotoTab.ALL, label: "All" },
        { key: PhotoTab.FAMILY, label: "Family" },
        { key: PhotoTab.HOME, label: resident.branchName },
      ],
      photos: photos.map((photo, index) => ({
        ...toPhoto(photo, resident),
        isLatest: page === 1 && index === 0,
      })),
    },
    meta: generateMeta(page, limit, total),
  };
};

const getPhotoScreen = async ({ resident, mediaId, tab: requestedTab }) => {
  const tab = parseTab(requestedTab);
  const notFound = () => new AppError("resident_media_not_found", 404);
  if (!isValidObjectId(mediaId)) throw notFound();

  const { photoSharing, scope } = await loadPhotoAccess(resident);
  if (!photoSharing) throw notFound();

  const [result] = await FamilyUpload.aggregate([
    ...photoStages({ scope, tab }),
    {
      $facet: {
        order: [newestFirst, { $project: { _id: 0, mediaId: "$media._id" } }],
        photo: [
          { $match: { "media._id": toObjectId(mediaId) } },
          { $limit: 1 },
          ...tileStages,
        ],
      },
    },
  ]);

  const ids = result.order.map((row) => String(row.mediaId));
  const index = ids.indexOf(String(toObjectId(mediaId)));
  if (index < 0) throw notFound();

  return {
    tab,
    photo: toPhoto(result.photo[0], resident),
    position: index + 1,
    total: ids.length,
    previousMediaId: ids[index - 1] || null,
    nextMediaId: ids[index + 1] || null,
  };
};

module.exports = { getPhotosScreen, getPhotoScreen, PhotoTab };
