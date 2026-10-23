const { FamilyReaction } = require("@models/FamilyReaction");
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
            mine: { $sum: { $cond: [{ $eq: ["$userId", userId ? toObjectId(userId) : null] }, 1, 0] } },
          },
        },
      ],
      as: "reactionStats",
    },
  },
  {
    $addFields: {
      reactionCount: { $ifNull: [{ $arrayElemAt: ["$reactionStats.count", 0] }, 0] },
      reactedByMe: { $gt: [{ $ifNull: [{ $arrayElemAt: ["$reactionStats.mine", 0] }, 0] }, 0] },
    },
  },
];

/** Wall posts show the photo as uploaded; only family uploads are ever blurred. */
const postPhotos = {
  $map: { input: "$media", as: "media", in: { mediaId: "$$media._id", url: "$$media.url" } },
};

module.exports = { reactionStats, postPhotos };
