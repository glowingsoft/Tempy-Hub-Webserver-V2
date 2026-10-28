const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyReaction } = require("@models/FamilyReaction");
const { FamilyPostView } = require("@models/FamilyPostView");
const { FamilyPostReport } = require("@models/FamilyPostReport");
const { visibleToLink, visibleToAny } = require("@utils/familyPostVisibility");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");
const { reactionStats, postPhotos } = require("./familyWallPipeline");

const MAX_SEEN_BATCH = 50;
const MAX_REPORT_REASON = 500;

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
      title: 1,
      message: 1,
      photos: 1,
      taggedResidents: 1,
      audience: { $ifNull: ["$audience", "branch"] },
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
    match: visibleToLink(link),
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
    { $match: { _id: toObjectId(postId), ...visibleToAny(links) } },
    { $project: { organizationId: 1, branchId: 1 } },
  ]);
  if (!post) throw new AppError("post_not_found", 404);
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

const sameHome = (link, post) =>
  String(link.organizationId) === String(post.organizationId) && String(link.branchId) === String(post.branchId);

/** The posts the app showed on screen. Only posts the caller may see count, and sending one twice changes nothing. */
const markSeen = async ({ userId, links, postIds }) => {
  if (!Array.isArray(postIds) || !postIds.length) throw new AppError("post_ids_required", 400);
  const ids = [...new Set(postIds.map(String))];
  if (ids.length > MAX_SEEN_BATCH) throw new AppError("too_many_posts", 400);
  if (!ids.every(isValidObjectId)) throw new AppError("post_not_found", 404);

  const homes = [...new Map(links.map((link) => [`${link.organizationId}:${link.branchId}`, link])).values()];
  if (!homes.length) return { seen: 0 };

  const posts = await FamilyPost.aggregate([
    {
      $match: {
        _id: { $in: ids.map(toObjectId) },
        ...visibleToAny(links),
      },
    },
    { $project: { organizationId: 1, branchId: 1 } },
  ]);
  if (!posts.length) return { seen: 0 };

  await FamilyPostView.bulkWrite(
    posts.map((post) => ({
      updateOne: {
        filter: { postId: post._id, userId: toObjectId(userId) },
        update: {
          $setOnInsert: { postId: post._id, userId: toObjectId(userId), organizationId: post.organizationId, branchId: post.branchId },
          $addToSet: { residentIds: { $each: links.filter((link) => sameHome(link, post)).map((link) => toObjectId(link.residentId)) } },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { seen: posts.length };
};

/** Flag a post for staff. Reporting twice is the same as reporting once, and the poster is never told who. */
const reportPost = async ({ userId, links, postId, reason }) => {
  const post = await assertPostVisible({ postId, links });

  if (reason !== undefined && reason !== null && typeof reason !== "string") throw new AppError("report_reason_invalid", 400);
  const text = String(reason ?? "").trim();
  if (text.length > MAX_REPORT_REASON) throw new AppError("report_reason_too_long", 400);

  try {
    await FamilyPostReport.updateOne(
      { postId: toObjectId(postId), reporterId: toObjectId(userId) },
      {
        $setOnInsert: {
          postId: toObjectId(postId),
          reporterId: toObjectId(userId),
          organizationId: post.organizationId,
          branchId: post.branchId,
          reason: text,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  return { postId, reported: true };
};

module.exports = { listWall, addReaction, removeReaction, markSeen, reportPost };
