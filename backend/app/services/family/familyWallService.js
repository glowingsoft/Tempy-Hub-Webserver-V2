const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyReaction } = require("@models/FamilyReaction");
const { FamilyPostStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");
const { reactionStats, postPhotos } = require("./familyWallPipeline");

const isDuplicateKey = (error) => error?.code === 11000;

/**
 * Only the residents the caller is linked to are named: a tag on the wall says who it is for,
 * but never reveals another family's resident.
 */
const wallPostStages = ({ userId, linkedResidentIds }) => [
  { $lookup: { from: FamilyMedia.collection.name, localField: "mediaIds", foreignField: "_id", as: "media" } },
  { $lookup: { from: Resident.collection.name, localField: "taggedResidentIds", foreignField: "_id", as: "tagged" } },
  ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
  ...joinOne({ from: Branch, localField: "branchId", as: "branch", optional: true }),
  ...reactionStats(userId),
  {
    $addFields: {
      photos: postPhotos,
      taggedResidents: {
        $map: {
          input: {
            $filter: {
              input: "$tagged",
              as: "resident",
              cond: { $in: ["$$resident._id", linkedResidentIds.map(toObjectId)] },
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
      postId: "$_id",
      branchId: 1,
      homeName: { $ifNull: ["$branch.name", ""] },
      authorName: { $ifNull: ["$author.name", ""] },
      authorPhotoUrl: { $ifNull: ["$author.profileIcon", ""] },
      message: 1,
      photos: 1,
      taggedResidents: 1,
      isPinned: 1,
      reactionCount: 1,
      reactedByMe: 1,
      createdAt: 1,
    },
  },
];

const listWall = ({ link, userId, links, page, limit, skip }) =>
  paginateWithFacet({
    model: FamilyPost,
    match: {
      organizationId: toObjectId(link.organizationId),
      branchId: toObjectId(link.branchId),
      status: FamilyPostStatus.PUBLISHED,
    },
    page,
    limit,
    skip,
    sort: { isPinned: -1, createdAt: -1, _id: -1 },
    extraDataStages: wallPostStages({ userId, linkedResidentIds: links.map((l) => l.residentId) }),
  });

const reactionSummary = async ({ postId, userId }) => {
  const [stats] = await FamilyReaction.aggregate([
    { $match: { postId: toObjectId(postId) } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        mine: { $sum: { $cond: [{ $eq: ["$userId", toObjectId(userId)] }, 1, 0] } },
      },
    },
  ]);
  return { postId, reactionCount: stats?.count ?? 0, reactedByMe: (stats?.mine ?? 0) > 0 };
};

const assertPostVisible = async ({ postId, links }) => {
  if (!isValidObjectId(postId)) throw new AppError("post_not_found", 404);

  const [post] = await FamilyPost.aggregate([
    { $match: { _id: toObjectId(postId), status: FamilyPostStatus.PUBLISHED } },
    { $project: { organizationId: 1, branchId: 1 } },
  ]);
  const visible =
    post &&
    links.some(
      (link) =>
        String(link.organizationId) === String(post.organizationId) &&
        String(link.branchId) === String(post.branchId)
    );
  if (!visible) throw new AppError("post_not_found", 404);
  return post;
};

/** One tap. Sending it again changes nothing. */
const addReaction = async ({ userId, links, postId }) => {
  await assertPostVisible({ postId, links });
  try {
    await FamilyReaction.updateOne(
      { postId: toObjectId(postId), userId: toObjectId(userId) },
      { $setOnInsert: { postId: toObjectId(postId), userId: toObjectId(userId) } },
      { upsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  return reactionSummary({ postId, userId });
};

const removeReaction = async ({ userId, links, postId }) => {
  await assertPostVisible({ postId, links });
  await FamilyReaction.deleteOne({ postId: toObjectId(postId), userId: toObjectId(userId) });
  return reactionSummary({ postId, userId });
};

module.exports = { listWall, addReaction, removeReaction };
