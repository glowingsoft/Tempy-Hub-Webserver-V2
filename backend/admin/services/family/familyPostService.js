const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyMember } = require("@models/FamilyMember");
const { NotificationExp } = require("@models/Notifications");
const { AdmissionStatus, FamilyMemberStatus, FamilyPostStatus } = require("@models/domainEnums");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/residents/residentAccess");
const { inTransaction } = require("@appServices/family/familyLinkActions");
const { toObjectId, isValidObjectId, joinOne } = require("@appServices/family/familyPipeline");
const { reactionStats, postPhotos } = require("@appServices/family/familyWallPipeline");
const { searchText } = require("@utils/familyQuery");

const MAX_POST_LENGTH = 2000;
const MAX_PHOTOS = 10;
const MAX_TAGS = 50;
const NOTIFY_CHUNK = 1000;

const normaliseMessage = (message) => {
  const text = String(message ?? "").trim();
  if (text.length > MAX_POST_LENGTH) throw new AppError("post_too_long", 400);
  return text;
};

const normaliseIds = (ids, { max, tooMany, invalid }) => {
  if (!Array.isArray(ids)) throw new AppError("post_ids_invalid", 400);
  const unique = [...new Set(ids.map(String))];
  if (unique.length > max) throw new AppError(tooMany, 400);
  if (!unique.every(isValidObjectId)) throw new AppError(invalid, 400);
  return unique;
};

const PHOTO_RULES = { max: MAX_PHOTOS, tooMany: "too_many_photos", invalid: "media_not_found" };
const TAG_RULES = { max: MAX_TAGS, tooMany: "too_many_tags", invalid: "residents_cannot_be_tagged" };

/** A post can only tag residents of its own site whose photo sharing is on; anyone else is refused, not skipped. */
const assertTaggable = async ({ organizationId, branchId, residentIds }) => {
  if (!residentIds.length) return;

  const [found] = await Resident.aggregate([
    {
      $match: {
        _id: { $in: residentIds.map(toObjectId) },
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        admissionStatus: AdmissionStatus.ADMITTED,
        photographyConsent: true,
      },
    },
    { $count: "count" },
  ]);
  if ((found?.count ?? 0) !== residentIds.length) throw new AppError("residents_cannot_be_tagged", 400);
};

const assertMediaUsable = async ({ userId, mediaIds, postId = null }) => {
  if (!mediaIds.length) return;

  const [found] = await FamilyMedia.aggregate([
    {
      $match: {
        _id: { $in: mediaIds.map(toObjectId) },
        uploadedBy: toObjectId(userId),
        uploadId: null,
        postId: { $in: postId ? [null, toObjectId(postId)] : [null] },
      },
    },
    { $count: "count" },
  ]);
  if ((found?.count ?? 0) !== mediaIds.length) throw new AppError("media_not_found", 400);
};

/** The site a post belongs to: the one asked for, or the caller's own. A site or line manager cannot reach another site. */
const resolveBranch = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const target = branchId || standing.branchId;
  if (!target) throw new AppError("branch_required", 400);

  assertMayAccessResidents(standing, target);
  await assertBranchInOrganization(target, organizationId);
  return target;
};

const postRowStages = (userId = null) => [
  { $lookup: { from: FamilyMedia.collection.name, localField: "mediaIds", foreignField: "_id", as: "media" } },
  { $lookup: { from: Resident.collection.name, localField: "taggedResidentIds", foreignField: "_id", as: "tagged" } },
  ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
  ...joinOne({ from: Branch, localField: "branchId", as: "branch", optional: true }),
  ...reactionStats(userId),
  {
    $addFields: {
      photos: postPhotos,
      taggedResidents: {
        $map: { input: "$tagged", as: "resident", in: { residentId: "$$resident._id", name: "$$resident.name" } },
      },
    },
  },
  {
    $project: {
      _id: 0,
      postId: "$_id",
      branchId: 1,
      homeName: { $ifNull: ["$branch.name", ""] },
      authorId: 1,
      authorName: { $ifNull: ["$author.name", ""] },
      message: 1,
      photos: 1,
      taggedResidents: 1,
      isPinned: 1,
      status: 1,
      reactionCount: 1,
      createdAt: 1,
      removedAt: 1,
    },
  },
];

const statusCountsOf = (rows = []) => {
  const counts = Object.fromEntries(Object.values(FamilyPostStatus).map((status) => [status, 0]));
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

/** The staff Community Wall: every post of the organization, pinned first. meta.counts ignores the status filter. */
const listPosts = async ({ organizationId, branchId, residentId, status, keyword, page, limit, skip }) => {
  const wanted = status || FamilyPostStatus.PUBLISHED;
  if (!Object.values(FamilyPostStatus).includes(wanted)) throw new AppError("invalid_status_filter", 400);

  const base = { organizationId: toObjectId(organizationId) };
  if (branchId) base.branchId = toObjectId(branchId);
  if (residentId) base.taggedResidentIds = toObjectId(residentId);
  const or = keywordOr(searchText(keyword), ["message"], { trim: true });
  if (or) base.$or = or;

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyPost,
    match: { ...base, status: wanted },
    page,
    limit,
    skip,
    sort:
      wanted === FamilyPostStatus.PUBLISHED
        ? { isPinned: -1, createdAt: -1, _id: -1 }
        : { removedAt: -1, _id: -1 },
    extraFacets: {
      statusCounts: [{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }],
    },
    extraDataStages: postRowStages(),
  });

  return { data, meta: { ...meta, counts: statusCountsOf(result.statusCounts) } };
};

const getPostRow = async (postId) => {
  const [row] = await FamilyPost.aggregate([{ $match: { _id: toObjectId(postId) } }, ...postRowStages()]);
  return row;
};

const listTaggableResidents = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId);
  assertMayAccessResidents(standing, scoped);
  await assertBranchInOrganization(scoped, organizationId);

  const match = {
    organizationId: toObjectId(organizationId),
    admissionStatus: AdmissionStatus.ADMITTED,
    photographyConsent: true,
  };
  if (scoped) match.branchId = toObjectId(scoped);

  return Resident.aggregate([
    { $match: match },
    { $sort: { name: 1, _id: 1 } },
    {
      $project: {
        _id: 0,
        residentId: "$_id",
        name: 1,
        roomNumber: { $ifNull: ["$roomNumber", ""] },
        photoUrl: { $ifNull: ["$photoUrl", ""] },
        branchId: 1,
      },
    },
  ]);
};

/** Families at the site hear about it once; a failure here never undoes the post. */
const notifyFamilies = async ({ post, actor, homeName }) => {
  try {
    const members = await FamilyMember.aggregate([
      {
        $match: {
          organizationId: toObjectId(post.organizationId),
          branchId: toObjectId(post.branchId),
          status: FamilyMemberStatus.ACTIVE,
        },
      },
      { $group: { _id: "$userId" } },
    ]);

    const title = `New post from ${homeName || "your home"}`;
    const body = post.message ? post.message.slice(0, 140) : "Photos were shared on the community wall.";
    for (let i = 0; i < members.length; i += NOTIFY_CHUNK) {
      await NotificationExp.insertMany(
        members.slice(i, i + NOTIFY_CHUNK).map((member) => ({
          type: "familyNewPost",
          subjectId: actor._id,
          objectId: post._id,
          objectType: "familyPost",
          receiverId: member._id,
          title,
          body,
        })),
        { ordered: false }
      );
    }
  } catch (error) {
    console.error("family post notification failed", error.message);
  }
};

const createPost = async ({ actor, organizationId, branchId, message, mediaIds = [], taggedResidentIds = [], isPinned }) => {
  const site = await resolveBranch({ actor, organizationId, branchId });
  const text = normaliseMessage(message);
  const photos = normaliseIds(mediaIds, PHOTO_RULES);
  const tags = normaliseIds(taggedResidentIds, TAG_RULES);
  if (!text && !photos.length) throw new AppError("post_empty", 400);

  await assertTaggable({ organizationId, branchId: site, residentIds: tags });
  await assertMediaUsable({ userId: actor._id, mediaIds: photos });

  let created;
  await inTransaction(async (session) => {
    [created] = await FamilyPost.create(
      [
        {
          organizationId,
          branchId: site,
          authorId: actor._id,
          message: text,
          mediaIds: photos.map(toObjectId),
          taggedResidentIds: tags.map(toObjectId),
          isPinned: Boolean(isPinned),
        },
      ],
      { session }
    );
    if (photos.length) {
      const attached = await FamilyMedia.updateMany(
        { _id: { $in: photos.map(toObjectId) }, uploadedBy: actor._id, uploadId: null, postId: null },
        { $set: { postId: created._id } },
        { session }
      );
      if (attached.modifiedCount !== photos.length) throw new AppError("media_not_found", 400);
    }
  });

  const row = await getPostRow(created._id);
  await notifyFamilies({ post: created, actor, homeName: row?.homeName });
  return row;
};

const loadPublishedPost = async ({ actor, organizationId, postId }) => {
  if (!isValidObjectId(postId)) throw new AppError("post_not_found", 404);

  const [post] = await FamilyPost.aggregate([
    {
      $match: {
        _id: toObjectId(postId),
        organizationId: toObjectId(organizationId),
        status: FamilyPostStatus.PUBLISHED,
      },
    },
    { $project: { branchId: 1, message: 1, mediaIds: 1, taggedResidentIds: 1, isPinned: 1 } },
  ]);
  if (!post) throw new AppError("post_not_found", 404);

  assertMayAccessResidents(await actorStanding(actor, organizationId), post.branchId);
  return post;
};

const updatePost = async ({ actor, organizationId, postId, message, mediaIds, taggedResidentIds, isPinned }) => {
  const post = await loadPublishedPost({ actor, organizationId, postId });

  const text = message === undefined ? post.message : normaliseMessage(message);
  const photos =
    mediaIds === undefined
      ? post.mediaIds.map(String)
      : normaliseIds(mediaIds, PHOTO_RULES);
  const tags =
    taggedResidentIds === undefined
      ? post.taggedResidentIds.map(String)
      : normaliseIds(taggedResidentIds, TAG_RULES);
  if (!text && !photos.length) throw new AppError("post_empty", 400);

  if (taggedResidentIds !== undefined) {
    await assertTaggable({ organizationId, branchId: post.branchId, residentIds: tags });
  }
  await assertMediaUsable({ userId: actor._id, mediaIds: photos, postId });

  await inTransaction(async (session) => {
    const updated = await FamilyPost.updateOne(
      { _id: post._id, status: FamilyPostStatus.PUBLISHED },
      {
        $set: {
          message: text,
          mediaIds: photos.map(toObjectId),
          taggedResidentIds: tags.map(toObjectId),
          isPinned: isPinned === undefined ? post.isPinned : Boolean(isPinned),
        },
      },
      { session }
    );
    if (!updated.modifiedCount) throw new AppError("post_not_found", 404);

    await FamilyMedia.updateMany(
      { postId: post._id, _id: { $nin: photos.map(toObjectId) } },
      { $set: { postId: null } },
      { session }
    );
    if (photos.length) {
      await FamilyMedia.updateMany(
        { _id: { $in: photos.map(toObjectId) }, uploadedBy: actor._id },
        { $set: { postId: post._id } },
        { session }
      );
    }
  });

  return getPostRow(post._id);
};

/** Removed posts leave every feed, and later newsletters and gazettes. The row is kept. */
const removePost = async ({ actor, organizationId, postId }) => {
  const post = await loadPublishedPost({ actor, organizationId, postId });

  const removed = await FamilyPost.updateOne(
    { _id: post._id, status: FamilyPostStatus.PUBLISHED },
    { $set: { status: FamilyPostStatus.REMOVED, removedBy: actor._id, removedAt: new Date() } }
  );
  if (!removed.modifiedCount) throw new AppError("post_not_found", 404);

  return { postId: post._id, status: FamilyPostStatus.REMOVED };
};

module.exports = {
  listPosts,
  listTaggableResidents,
  createPost,
  updatePost,
  removePost,
};
