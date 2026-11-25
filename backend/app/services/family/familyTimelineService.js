const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyMember } = require("@models/FamilyMember");
const { Resident } = require("@models/Resident");
const { FamilyUploadStatus, FamilyPostStatus } = require("@models/domainEnums");
const { facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { toObjectId, joinOne } = require("./familyPipeline");
const { reactionStats } = require("./familyWallPipeline");

const TimelineItemType = { UPLOAD: "upload", WALL_POST: "wallPost" };

/** Only the blurred copy is shown once a manager made one; wall photos never have one. */
const photoUrl = {
  $cond: [
    { $ne: ["$$media.blurredUrl", ""] },
    "$$media.blurredUrl",
    "$$media.url",
  ],
};

const isUpload = { $eq: ["$kind", TimelineItemType.UPLOAD] };

const itemStages = ({ residentId, userId, linkedResidentIds }) => [
  {
    $lookup: {
      from: FamilyMedia.collection.name,
      localField: "mediaIds",
      foreignField: "_id",
      as: "media",
    },
  },
  {
    $lookup: {
      from: Resident.collection.name,
      localField: "taggedResidentIds",
      foreignField: "_id",
      as: "tagged",
    },
  },
  ...joinOne({
    from: User,
    localField: "authorId",
    as: "author",
    optional: true,
  }),
  ...joinOne({
    from: Branch,
    localField: "branchId",
    as: "branch",
    optional: true,
  }),
  {
    $lookup: {
      from: FamilyMember.collection.name,
      let: { authorId: "$authorId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$authorId"] },
                { $eq: ["$residentId", toObjectId(residentId)] },
              ],
            },
          },
        },
        { $limit: 1 },
        { $project: { relationship: 1 } },
      ],
      as: "authorLink",
    },
  },
  ...reactionStats(userId),
  {
    $addFields: {
      photos: {
        $map: {
          input: "$media",
          as: "media",
          in: { mediaId: "$$media._id", url: photoUrl },
        },
      },
      authorRelationship: {
        $ifNull: [{ $arrayElemAt: ["$authorLink.relationship", 0] }, ""],
      },
      taggedResidents: {
        $map: {
          input: {
            $filter: {
              input: "$tagged",
              as: "resident",
              cond: { $in: ["$$resident._id", linkedResidentIds] },
            },
          },
          as: "resident",
          in: { residentId: "$$resident._id", name: "$$resident.name" },
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      type: "$kind",
      audience: { $cond: [isUpload, "family", "everyone"] },
      uploadId: { $cond: [isUpload, "$_id", null] },
      postId: { $cond: [isUpload, null, "$_id"] },
      residentId: { $literal: toObjectId(residentId) },
      homeName: { $ifNull: ["$branch.name", ""] },
      authorName: { $ifNull: ["$author.name", ""] },
      authorPhotoUrl: { $ifNull: ["$author.profileIcon", ""] },
      authorRelationship: 1,
      title: { $ifNull: ["$title", ""] },
      message: 1,
      photos: 1,
      taggedResidents: 1,
      reactionCount: { $cond: [isUpload, 0, "$reactionCount"] },
      reactedByMe: { $cond: [isUpload, false, "$reactedByMe"] },
      isPinned: { $eq: ["$isPinned", true] },
      publishedAt: "$sortAt",
    },
  },
];

/** Approved uploads and tagged wall posts for the resident, newest first. `link` is the caller's active link, so a removed member sees nothing. */
const listTimeline = async ({
  link,
  links,
  userId,
  page,
  limit,
  skip,
  familyPostsOnly = false,
}) => {
  const residentId = toObjectId(link.residentId);

  const [result] = await FamilyUpload.aggregate([
    { $match: { residentId, status: FamilyUploadStatus.APPROVED } },
    {
      $project: {
        kind: { $literal: TimelineItemType.UPLOAD },
        isPinned: { $literal: false },
        sortAt: "$decidedAt",
        authorId: 1,
        branchId: 1,
        message: 1,
        mediaIds: 1,
      },
    },
    // familyPostsOnly: just what this resident's family uploaded, no home wall posts.
    ...(familyPostsOnly
      ? []
      : [
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
                    kind: { $literal: TimelineItemType.WALL_POST },
                    isPinned: 1,
                    sortAt: "$createdAt",
                    authorId: 1,
                    branchId: 1,
                    title: 1,
                    message: 1,
                    mediaIds: 1,
                    taggedResidentIds: 1,
                  },
                },
              ],
            },
          },
        ]),
    {
      $facet: {
        data: [
          { $sort: { isPinned: -1, sortAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          ...itemStages({
            residentId,
            userId,
            linkedResidentIds: (links || [link]).map((row) =>
              toObjectId(row.residentId),
            ),
          }),
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  return {
    data: result.data,
    meta: generateMeta(page, limit, facetCount(result.totalCount)),
  };
};

module.exports = { listTimeline };
