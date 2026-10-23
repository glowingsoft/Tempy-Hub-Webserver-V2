const { User } = require("@models/UserModel");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUploadStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { toObjectId, joinOne } = require("./familyPipeline");

const TimelineItemType = { UPLOAD: "upload" };

/** Only the blurred copy is shown once a manager made one. */
const photoUrl = {
  $cond: [{ $ne: ["$$media.blurredUrl", ""] }, "$$media.blurredUrl", "$$media.url"],
};

const itemStages = (residentId) => [
  { $lookup: { from: FamilyMedia.collection.name, localField: "mediaIds", foreignField: "_id", as: "media" } },
  ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
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
  {
    $addFields: {
      photos: {
        $map: { input: "$media", as: "media", in: { mediaId: "$$media._id", url: photoUrl } },
      },
      authorRelationship: { $ifNull: [{ $arrayElemAt: ["$authorLink.relationship", 0] }, ""] },
    },
  },
  {
    $project: {
      _id: 0,
      type: { $literal: TimelineItemType.UPLOAD },
      uploadId: "$_id",
      residentId: 1,
      authorName: { $ifNull: ["$author.name", ""] },
      authorPhotoUrl: { $ifNull: ["$author.profileIcon", ""] },
      authorRelationship: 1,
      message: 1,
      photos: 1,
      publishedAt: "$decidedAt",
    },
  },
];

/**
 * The Family tab: what has been shared about the resident, newest first. Only approved uploads
 * appear, from any member of the family; waiting and rejected ones stay with their author.
 * `link` is the caller's active link to the resident, so a removed member sees nothing.
 */
const listTimeline = ({ link, page, limit, skip }) =>
  paginateWithFacet({
    model: FamilyUpload,
    match: { residentId: toObjectId(link.residentId), status: FamilyUploadStatus.APPROVED },
    page,
    limit,
    skip,
    sort: { decidedAt: -1, _id: -1 },
    extraDataStages: itemStages(link.residentId),
  });

module.exports = { listTimeline, TimelineItemType };
