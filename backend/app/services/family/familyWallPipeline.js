const { FamilyReaction } = require("@models/FamilyReaction");
const { FamilyPostPin } = require("@models/FamilyPostPin");
const { toObjectId } = require("./familyPipeline");

/** reactionCount and, for the caller, reactedByMe, joined onto rows whose _id is a wall post. */
const reactionStats = (userId = null) => [
  {
    $lookup: {
      from: FamilyReaction.collection.name,
      let: { postId: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$postId", "$$postId"] } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            mine: {
              $sum: {
                $cond: [
                  { $eq: ["$userId", userId ? toObjectId(userId) : null] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ],
      as: "reactionStats",
    },
  },
  {
    $addFields: {
      reactionCount: {
        $ifNull: [{ $arrayElemAt: ["$reactionStats.count", 0] }, 0],
      },
      reactedByMe: {
        $gt: [
          { $ifNull: [{ $arrayElemAt: ["$reactionStats.mine", 0] }, 0] },
          0,
        ],
      },
    },
  },
];

/** isPinnedByMe: whether the caller saved this post for themselves (not the staff pin, isPinned). */
const pinnedByMe = (userId = null) => [
  {
    $lookup: {
      from: FamilyPostPin.collection.name,
      let: { postId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$postId", "$$postId"] },
                { $eq: ["$userId", userId ? toObjectId(userId) : null] },
              ],
            },
          },
        },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: "myPin",
    },
  },
  { $addFields: { isPinnedByMe: { $gt: [{ $size: "$myPin" }, 0] } } },
];

/** Wall posts show the photo as uploaded; only family uploads are ever blurred. */
const postPhotos = {
  $map: {
    input: "$media",
    as: "media",
    in: { mediaId: "$$media._id", url: "$$media.url" },
  },
};

module.exports = { reactionStats, pinnedByMe, postPhotos };
