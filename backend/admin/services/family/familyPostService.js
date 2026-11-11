const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyPostReport } = require("@models/FamilyPostReport");
const { FamilyMember } = require("@models/FamilyMember");
const { NotificationExp } = require("@models/Notifications");
const {
  AdmissionStatus,
  BranchStatus,
  FamilyMemberStatus,
  FamilyPostAudience,
  FamilyPostReportStatus,
  FamilyPostStatus,
} = require("@models/domainEnums");
const { audienceLabelOf } = require("@utils/familyPostVisibility");
const { getWallGazetteCard } = require("./familyGazetteCard");
const moment = require("moment-timezone");
const { paginateWithFacet, facetCount, allCountFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/residents/residentAccess");
const { inTransaction } = require("@appServices/family/familyLinkActions");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
} = require("@appServices/family/familyPipeline");
const {
  reactionStats,
  postPhotos,
} = require("@appServices/family/familyWallPipeline");
const { searchClause } = require("./familySearch");
const { resolveSite } = require("./familySite");
const { authorRoleStages } = require("./familyAuthor");
const {
  decoratePosts,
  actionReports,
  getAttention,
  getStaffActivity,
} = require("./familyWallActivityService");

const MAX_POST_LENGTH = 2000;
const MAX_TITLE_LENGTH = 120;
const MAX_SCHEDULE_DAYS = 365;
const DUE_PER_RUN = 50;
const OPEN_STATUSES = [
  FamilyPostStatus.PUBLISHED,
  FamilyPostStatus.DRAFT,
  FamilyPostStatus.SCHEDULED,
];
const CREATE_STATUSES = [
  FamilyPostStatus.PUBLISHED,
  FamilyPostStatus.DRAFT,
  FamilyPostStatus.SCHEDULED,
];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const MAX_PHOTOS = 10;
const MAX_TAGS = 50;
const NOTIFY_CHUNK = 1000;

const parseSchedule = (value) => {
  const when = moment.utc(value, moment.ISO_8601, true);
  const now = moment.utc();
  if (
    typeof value !== "string" ||
    !when.isValid() ||
    !when.isAfter(now) ||
    when.isAfter(now.clone().add(MAX_SCHEDULE_DAYS, "days"))
  ) {
    throw new AppError("post_schedule_invalid", 400);
  }
  return when.toDate();
};

const AUDIENCES = Object.values(FamilyPostAudience);

const checkAudience = (audience, tags) => {
  if (!AUDIENCES.includes(audience))
    throw new AppError("invalid_post_audience", 400);
  if (audience === FamilyPostAudience.TAGGED && !tags.length)
    throw new AppError("audience_needs_tags", 400);
  return audience;
};

const normaliseTitle = (title) => {
  const text = String(title ?? "").trim();
  if (text.length > MAX_TITLE_LENGTH)
    throw new AppError("post_title_too_long", 400);
  return text;
};

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

const PHOTO_RULES = {
  max: MAX_PHOTOS,
  tooMany: "too_many_photos",
  invalid: "media_not_found",
};
const TAG_RULES = {
  max: MAX_TAGS,
  tooMany: "too_many_tags",
  invalid: "residents_cannot_be_tagged",
};

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
  if ((found?.count ?? 0) !== residentIds.length)
    throw new AppError("residents_cannot_be_tagged", 400);
};

// An owner leaving the site out gets the tagged residents' site, or the organization's only active site; otherwise it is still required.
const inferSite = async ({
  actor,
  organizationId,
  branchId,
  audience,
  taggedResidentIds,
}) => {
  if (branchId) return branchId;
  if ((await actorStanding(actor, organizationId)).branchId) return undefined;

  if (audience === FamilyPostAudience.TAGGED) {
    const tags = normaliseIds(taggedResidentIds, TAG_RULES);
    if (tags.length) {
      const sites = await Resident.aggregate([
        {
          $match: {
            _id: { $in: tags.map(toObjectId) },
            organizationId: toObjectId(organizationId),
          },
        },
        { $group: { _id: "$branchId" } },
      ]);
      if (sites.length > 1)
        throw new AppError("tagged_residents_different_sites", 400);
      if (sites.length === 1) return String(sites[0]._id);
    }
  }

  const branches = await Branch.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        status: { $ne: BranchStatus.SUSPENDED },
      },
    },
    { $project: { _id: 1 } },
    { $limit: 2 },
  ]);
  return branches.length === 1 ? String(branches[0]._id) : undefined;
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
  if ((found?.count ?? 0) !== mediaIds.length)
    throw new AppError("media_not_found", 400);
};

const resolveBranch = async (args) => (await resolveSite(args)).branchId;

const postRowStages = (userId = null) => [
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
  ...authorRoleStages(),
  ...reactionStats(userId),
  {
    $addFields: {
      photos: postPhotos,
      taggedResidents: {
        $map: {
          input: "$tagged",
          as: "resident",
          in: {
            residentId: "$$resident._id",
            name: "$$resident.name",
            photoUrl: { $ifNull: ["$$resident.photoUrl", ""] },
          },
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
      authorId: 1,
      authorName: { $ifNull: ["$author.name", ""] },
      authorPhotoUrl: { $ifNull: ["$author.profileIcon", ""] },
      authorRole: 1,
      title: 1,
      message: 1,
      photos: 1,
      taggedResidents: 1,
      audience: { $ifNull: ["$audience", FamilyPostAudience.BRANCH] },
      isPinned: 1,
      status: 1,
      scheduledAt: 1,
      reactionCount: 1,
      createdAt: 1,
      removedAt: 1,
    },
  },
];

const POST_STATUSES = Object.values(FamilyPostStatus);

const statusCountsOf = (rows = [], result) => {
  const counts = {
    all: facetCount(result?.allCount),
    ...Object.fromEntries(POST_STATUSES.map((status) => [status, 0])),
  };
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

const dateFilter = ({ from, to }) => {
  const range = {};
  for (const [key, value, edge] of [
    ["$gte", from, "T00:00:00.000Z"],
    ["$lte", to, "T23:59:59.999Z"],
  ]) {
    if (value === undefined) continue;
    if (!DATE_ONLY.test(value) || Number.isNaN(Date.parse(`${value}${edge}`)))
      throw new AppError("invalid_date_filter", 400);
    range[key] = new Date(`${value}${edge}`);
  }
  return Object.keys(range).length ? range : null;
};

const listPosts = async ({
  organizationId,
  branchId,
  residentId,
  authorId,
  status,
  pinned,
  hasPhotos,
  reported,
  from,
  to,
  sort,
  keyword,
  days,
  audience,
  page,
  limit,
  skip,
}) => {
  const wanted = status || FamilyPostStatus.PUBLISHED;
  if (!Object.values(FamilyPostStatus).includes(wanted))
    throw new AppError("invalid_status_filter", 400);
  if (sort !== undefined && !["newest", "oldest"].includes(sort))
    throw new AppError("invalid_sort", 400);
  if (audience !== undefined && !AUDIENCES.includes(audience))
    throw new AppError("invalid_post_audience", 400);

  const base = { organizationId: toObjectId(organizationId) };
  if (branchId) base.branchId = toObjectId(branchId);
  if (residentId) base.taggedResidentIds = toObjectId(residentId);
  if (authorId) base.authorId = toObjectId(authorId);
  const lastDays = days === undefined ? null : Number(days);
  if (
    lastDays !== null &&
    (!Number.isInteger(lastDays) || lastDays < 1 || lastDays > 365)
  )
    throw new AppError("invalid_days", 400);
  if (lastDays !== null && (from !== undefined || to !== undefined))
    throw new AppError("invalid_date_filter", 400);
  const range =
    lastDays === null
      ? dateFilter({ from, to })
      : { $gte: new Date(Date.now() - lastDays * 24 * 60 * 60 * 1000) };
  if (range) base.createdAt = range;
  if (audience === FamilyPostAudience.BRANCH)
    base.audience = { $in: [FamilyPostAudience.BRANCH, null] };
  else if (audience) base.audience = audience;

  const or = await searchClause({
    keyword,
    organizationId,
    branchId,
    fields: ["title", "message"],
    resident: "taggedResidentIds",
    person: { model: FamilyPost, field: "authorId", path: "authorId" },
  });
  if (or) base.$or = or;

  const narrowed = { ...base, status: wanted };
  if (reported === "true") {
    const flagged = await FamilyPostReport.aggregate([
      {
        $match: {
          organizationId: toObjectId(organizationId),
          status: FamilyPostReportStatus.OPEN,
        },
      },
      { $group: { _id: "$postId" } },
    ]);
    narrowed._id = { $in: flagged.map((row) => row._id) };
  }
  if (pinned === "true") narrowed.isPinned = true;
  if (hasPhotos === "true") narrowed["mediaIds.0"] = { $exists: true };

  const live = { ...base, status: FamilyPostStatus.PUBLISHED };
  const direction = sort === "oldest" ? 1 : -1;

  const [{ result, data, meta }, attention, activity, gazette] =
    await Promise.all([
      paginateWithFacet({
        model: FamilyPost,
        match: narrowed,
        page,
        limit,
        skip,
        sort: {
          [FamilyPostStatus.PUBLISHED]: {
            isPinned: -1,
            createdAt: direction,
            _id: direction,
          },
          [FamilyPostStatus.SCHEDULED]: { scheduledAt: 1, _id: 1 },
          [FamilyPostStatus.DRAFT]: { updatedAt: -1, _id: -1 },
          [FamilyPostStatus.REMOVED]: { removedAt: -1, _id: -1 },
        }[wanted],
        extraFacets: {
          ...allCountFacet(base),
          statusCounts: [
            { $match: base },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ],
          pinnedCount: [
            { $match: { ...live, isPinned: true } },
            { $count: "count" },
          ],
          photoCount: [
            { $match: { ...live, "mediaIds.0": { $exists: true } } },
            { $count: "count" },
          ],
        },
        extraDataStages: postRowStages(),
      }),
      getAttention({ organizationId, branchId }),
      getStaffActivity({ organizationId, branchId, days }),
      getWallGazetteCard({ organizationId, branchId }),
    ]);

  return {
    data: (await decoratePosts({ rows: data, organizationId })).map((row) => ({
      ...row,
      audienceLabel: audienceLabelOf(row.audience, row.homeName),
    })),
    meta: {
      ...meta,
      counts: {
        ...statusCountsOf(result.statusCounts, result),
        pinned: facetCount(result.pinnedCount),
        photos: facetCount(result.photoCount),
      },
      attention,
      activity,
      gazette,
    },
  };
};

const getPostRow = async (postId) => {
  const [row] = await FamilyPost.aggregate([
    { $match: { _id: toObjectId(postId) } },
    ...postRowStages(),
  ]);
  return row
    ? { ...row, audienceLabel: audienceLabelOf(row.audience, row.homeName) }
    : row;
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

/** Who has posted on the wall, for the Author filter: one row per person, with their role and number of posts. */
const listAuthors = async ({ organizationId, branchId, keyword }) => {
  const match = { organizationId: toObjectId(organizationId) };
  if (branchId) match.branchId = toObjectId(branchId);

  const rows = await FamilyPost.aggregate([
    { $match: match },
    { $group: { _id: "$authorId", postsCount: { $sum: 1 } } },
    { $addFields: { authorId: "$_id", organizationId: match.organizationId } },
    ...joinOne({ from: User, localField: "authorId", as: "author" }),
    ...authorRoleStages(),
    {
      $project: {
        _id: 0,
        authorId: 1,
        name: { $ifNull: ["$author.name", ""] },
        photoUrl: { $ifNull: ["$author.profileIcon", ""] },
        role: "$authorRole",
        postsCount: 1,
      },
    },
    ...(keyword
      ? [{ $match: { name: { $regex: keyword, $options: "i" } } }]
      : []),
    { $sort: { name: 1, authorId: 1 } },
  ]);
  return rows;
};

const notifyFamilies = async ({ post, actorId, homeName }) => {
  try {
    const reach = {
      organizationId: toObjectId(post.organizationId),
      status: FamilyMemberStatus.ACTIVE,
    };
    if (post.audience === FamilyPostAudience.TAGGED)
      reach.residentId = { $in: post.taggedResidentIds.map(toObjectId) };
    else if (post.audience !== FamilyPostAudience.ALL)
      reach.branchId = toObjectId(post.branchId);
    const members = await FamilyMember.aggregate([
      { $match: reach },
      { $group: { _id: "$userId" } },
    ]);

    const title = `New post from ${homeName || "your home"}`;
    const body = post.message
      ? post.message.slice(0, 140)
      : "Photos were shared on the community wall.";
    for (let i = 0; i < members.length; i += NOTIFY_CHUNK) {
      await NotificationExp.insertMany(
        members.slice(i, i + NOTIFY_CHUNK).map((member) => ({
          type: "familyNewPost",
          subjectId: actorId,
          objectId: post._id,
          objectType: "familyPost",
          receiverId: member._id,
          title,
          body,
        })),
        { ordered: false },
      );
    }
  } catch (error) {
    console.error("family post notification failed", error.message);
  }
};

const createPost = async ({
  actor,
  organizationId,
  branchId,
  title,
  message,
  status,
  scheduledAt,
  mediaIds = [],
  taggedResidentIds = [],
  isPinned,
  audience = FamilyPostAudience.ALL,
}) => {
  // Audience is checked before the site so its mistakes are reported as that.
  checkAudience(audience, normaliseIds(taggedResidentIds, TAG_RULES));
  const site = await resolveBranch({
    actor,
    organizationId,
    branchId: await inferSite({
      actor,
      organizationId,
      branchId,
      audience,
      taggedResidentIds,
    }),
  });
  const text = normaliseMessage(message);
  const heading = normaliseTitle(title);
  const state =
    status === undefined
      ? scheduledAt === undefined
        ? FamilyPostStatus.PUBLISHED
        : FamilyPostStatus.SCHEDULED
      : status;
  if (!CREATE_STATUSES.includes(state))
    throw new AppError("invalid_post_status", 400);
  const goesLiveAt =
    state === FamilyPostStatus.SCHEDULED ? parseSchedule(scheduledAt) : null;
  if (state !== FamilyPostStatus.SCHEDULED && scheduledAt !== undefined)
    throw new AppError("post_schedule_invalid", 400);
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
          title: heading,
          message: text,
          mediaIds: photos.map(toObjectId),
          taggedResidentIds: tags.map(toObjectId),
          audience,
          isPinned: Boolean(isPinned),
          status: state,
          scheduledAt: goesLiveAt,
        },
      ],
      { session },
    );
    if (photos.length) {
      const attached = await FamilyMedia.updateMany(
        {
          _id: { $in: photos.map(toObjectId) },
          uploadedBy: actor._id,
          uploadId: null,
          postId: null,
        },
        { $set: { postId: created._id } },
        { session },
      );
      if (attached.modifiedCount !== photos.length)
        throw new AppError("media_not_found", 400);
    }
  });

  const row = await getPostRow(created._id);
  if (state === FamilyPostStatus.PUBLISHED)
    await notifyFamilies({
      post: created,
      actorId: actor._id,
      homeName: row?.homeName,
    });
  return row;
};

const loadOpenPost = async ({ actor, organizationId, postId }) => {
  if (!isValidObjectId(postId)) throw new AppError("post_not_found", 404);

  const [post] = await FamilyPost.aggregate([
    {
      $match: {
        _id: toObjectId(postId),
        organizationId: toObjectId(organizationId),
        status: { $in: OPEN_STATUSES },
      },
    },
    {
      $project: {
        organizationId: 1,
        branchId: 1,
        authorId: 1,
        status: 1,
        title: 1,
        message: 1,
        mediaIds: 1,
        taggedResidentIds: 1,
        audience: 1,
        isPinned: 1,
      },
    },
  ]);
  if (!post) throw new AppError("post_not_found", 404);

  assertMayAccessResidents(
    await actorStanding(actor, organizationId),
    post.branchId,
  );
  return post;
};

const updatePost = async ({
  actor,
  organizationId,
  postId,
  title,
  message,
  status,
  scheduledAt,
  mediaIds,
  taggedResidentIds,
  isPinned,
  audience,
}) => {
  const post = await loadOpenPost({ actor, organizationId, postId });

  const text = message === undefined ? post.message : normaliseMessage(message);
  const heading =
    title === undefined ? post.title || "" : normaliseTitle(title);
  const photos =
    mediaIds === undefined
      ? post.mediaIds.map(String)
      : normaliseIds(mediaIds, PHOTO_RULES);
  const tags =
    taggedResidentIds === undefined
      ? post.taggedResidentIds.map(String)
      : normaliseIds(taggedResidentIds, TAG_RULES);
  if (!text && !photos.length) throw new AppError("post_empty", 400);
  const reach =
    audience === undefined
      ? post.audience || FamilyPostAudience.BRANCH
      : audience;
  checkAudience(reach, tags);

  const next = nextState({ post, status, scheduledAt });

  if (taggedResidentIds !== undefined) {
    await assertTaggable({
      organizationId,
      branchId: post.branchId,
      residentIds: tags,
    });
  }
  await assertMediaUsable({ userId: actor._id, mediaIds: photos, postId });

  await inTransaction(async (session) => {
    const updated = await FamilyPost.updateOne(
      { _id: post._id, status: post.status },
      {
        $set: {
          ...next.set,
          title: heading,
          message: text,
          mediaIds: photos.map(toObjectId),
          taggedResidentIds: tags.map(toObjectId),
          audience: reach,
          isPinned: isPinned === undefined ? post.isPinned : Boolean(isPinned),
        },
      },
      { session },
    );
    if (!updated.modifiedCount) throw new AppError("post_not_found", 404);

    await FamilyMedia.updateMany(
      { postId: post._id, _id: { $nin: photos.map(toObjectId) } },
      { $set: { postId: null } },
      { session },
    );
    if (photos.length) {
      await FamilyMedia.updateMany(
        { _id: { $in: photos.map(toObjectId) }, uploadedBy: actor._id },
        { $set: { postId: post._id } },
        { session },
      );
    }
  });

  const row = await getPostRow(post._id);
  if (next.wentLive)
    await notifyFamilies({ post, actorId: actor._id, homeName: row?.homeName });
  return row;
};

const nextState = ({ post, status, scheduledAt }) => {
  if (post.status === FamilyPostStatus.PUBLISHED) {
    if (
      (status !== undefined && status !== FamilyPostStatus.PUBLISHED) ||
      scheduledAt !== undefined
    ) {
      throw new AppError("post_already_published", 409);
    }
    return { set: {}, wentLive: false };
  }

  const target =
    status === undefined
      ? scheduledAt === undefined
        ? post.status
        : FamilyPostStatus.SCHEDULED
      : status;
  if (!CREATE_STATUSES.includes(target))
    throw new AppError("invalid_post_status", 400);

  if (target === FamilyPostStatus.PUBLISHED) {
    if (scheduledAt !== undefined)
      throw new AppError("post_schedule_invalid", 400);
    return {
      set: { status: target, createdAt: new Date(), scheduledAt: null },
      wentLive: true,
    };
  }
  if (target === FamilyPostStatus.SCHEDULED) {
    if (scheduledAt === undefined && post.status !== FamilyPostStatus.SCHEDULED)
      throw new AppError("post_schedule_invalid", 400);
    return {
      set: {
        status: target,
        ...(scheduledAt === undefined
          ? {}
          : { scheduledAt: parseSchedule(scheduledAt) }),
      },
      wentLive: false,
    };
  }
  if (scheduledAt !== undefined)
    throw new AppError("post_schedule_invalid", 400);
  return { set: { status: target, scheduledAt: null }, wentLive: false };
};

// Each due post is claimed by the update itself, so two servers never publish or announce it twice.
const publishDuePosts = async ({
  now = new Date(),
  limit = DUE_PER_RUN,
} = {}) => {
  let published = 0;

  for (let i = 0; i < limit; i += 1) {
    const post = await FamilyPost.findOneAndUpdate(
      { status: FamilyPostStatus.SCHEDULED, scheduledAt: { $lte: now } },
      { $set: { status: FamilyPostStatus.PUBLISHED, createdAt: now } },
      { sort: { scheduledAt: 1, _id: 1 }, new: true, lean: true },
    );
    if (!post) break;

    published += 1;
    const [branch] = await Branch.aggregate([
      { $match: { _id: post.branchId } },
      { $project: { name: 1 } },
    ]);
    await notifyFamilies({
      post,
      actorId: post.authorId,
      homeName: branch?.name,
    });
  }

  return { published };
};

const removePost = async ({ actor, organizationId, postId }) => {
  const post = await loadOpenPost({ actor, organizationId, postId });

  const removed = await FamilyPost.updateOne(
    { _id: post._id, status: FamilyPostStatus.PUBLISHED },
    {
      $set: {
        status: FamilyPostStatus.REMOVED,
        removedBy: actor._id,
        removedAt: new Date(),
      },
    },
  );
  if (!removed.modifiedCount) throw new AppError("post_not_found", 404);

  await actionReports({ postId: post._id, actorId: actor._id });
  return { postId: post._id, status: FamilyPostStatus.REMOVED };
};

module.exports = {
  publishDuePosts,
  listPosts,
  listTaggableResidents,
  listAuthors,
  createPost,
  updatePost,
  removePost,
};
