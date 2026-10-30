const { User } = require("@models/UserModel");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyPostReport } = require("@models/FamilyPostReport");
const { FamilyPostView } = require("@models/FamilyPostView");
const { FamilyReaction } = require("@models/FamilyReaction");
const { FamilyMember } = require("@models/FamilyMember");
const {
  FamilyMemberStatus,
  FamilyPostReportStatus,
  FamilyPostStatus,
  FamilyUploadStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
} = require("@appServices/family/familyPipeline");
const { authorRoleStages } = require("./familyAuthor");
const {
  actorStanding,
  assertMayAccessResidents,
} = require("@adminServices/residents/residentAccess");

const MAX_REACTORS = 3;
const MAX_REPORTS_SHOWN = 5;
const DEFAULT_ACTIVITY_DAYS = 30;
const MAX_ACTIVITY_DAYS = 365;
const MAX_ACTIVITY_AUTHORS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const countOf = (rows) =>
  new Map(rows.map((row) => [String(row._id), row.count]));

const decoratePosts = async ({ rows, organizationId }) => {
  if (!rows.length) return rows;

  const postIds = rows.map((row) => toObjectId(row.postId));

  const [seen, reactors, reports, audience] = await Promise.all([
    FamilyPostView.aggregate([
      { $match: { postId: { $in: postIds } } },
      { $unwind: "$residentIds" },
      { $group: { _id: { postId: "$postId", residentId: "$residentIds" } } },
      { $group: { _id: "$_id.postId", count: { $sum: 1 } } },
    ]),
    FamilyReaction.aggregate([
      { $match: { postId: { $in: postIds } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: "$postId", userIds: { $push: "$userId" } } },
      { $project: { userIds: { $slice: ["$userIds", MAX_REACTORS] } } },
      {
        $lookup: {
          from: User.collection.name,
          localField: "userIds",
          foreignField: "_id",
          as: "users",
        },
      },
    ]),
    FamilyPostReport.aggregate([
      {
        $match: {
          postId: { $in: postIds },
          status: FamilyPostReportStatus.OPEN,
        },
      },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$postId",
          count: { $sum: 1 },
          items: {
            $push: {
              reportId: "$_id",
              reporterId: "$reporterId",
              reason: "$reason",
              createdAt: "$createdAt",
            },
          },
        },
      },
      {
        $project: {
          count: 1,
          items: { $slice: ["$items", MAX_REPORTS_SHOWN] },
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: "items.reporterId",
          foreignField: "_id",
          as: "users",
        },
      },
    ]),
    FamilyMember.aggregate([
      {
        $match: {
          organizationId: toObjectId(organizationId),
          status: FamilyMemberStatus.ACTIVE,
        },
      },
      { $group: { _id: "$branchId", residents: { $addToSet: "$residentId" } } },
    ]),
  ]);

  const seenBy = countOf(seen);
  const reportsOn = new Map(
    reports.map((row) => {
      const byId = new Map(row.users.map((user) => [String(user._id), user]));
      const items = row.items.map(({ reporterId, ...item }) => ({
        ...item,
        reporterId,
        reporterName: byId.get(String(reporterId))?.name ?? "",
      }));
      return [String(row._id), { count: row.count, items }];
    }),
  );
  const residentsAt = new Map(
    audience.map((row) => [
      String(row._id),
      new Set(row.residents.map(String)),
    ]),
  );
  const everyone = new Set(
    audience.flatMap((row) => row.residents.map(String)),
  );
  const familiesFor = (row) => {
    if (row.audience === "all") return everyone.size;
    if (row.audience === "tagged")
      return (row.taggedResidents ?? []).filter((resident) =>
        everyone.has(String(resident.residentId)),
      ).length;
    return residentsAt.get(String(row.branchId))?.size ?? 0;
  };
  const reactorsOf = new Map(
    reactors.map((row) => {
      const byId = new Map(row.users.map((user) => [String(user._id), user]));
      const people = row.userIds
        .map((id) => byId.get(String(id)))
        .filter(Boolean)
        .map((user) => ({
          userId: user._id,
          name: user.name || "",
          photoUrl: user.profileIcon || "",
        }));
      return [String(row._id), people];
    }),
  );

  return rows.map((row) => ({
    ...row,
    seenCount: seenBy.get(String(row.postId)) ?? 0,
    audienceCount: familiesFor(row),
    recentReactors: reactorsOf.get(String(row.postId)) ?? [],
    reportCount: reportsOn.get(String(row.postId))?.count ?? 0,
    reports: reportsOn.get(String(row.postId))?.items ?? [],
  }));
};

const loadPostSite = async ({ organizationId, postId }) => {
  if (!isValidObjectId(postId)) throw new AppError("post_not_found", 404);

  const [post] = await FamilyPost.aggregate([
    {
      $match: {
        _id: toObjectId(postId),
        organizationId: toObjectId(organizationId),
      },
    },
    { $project: { branchId: 1 } },
  ]);
  if (!post) throw new AppError("post_not_found", 404);
  return post;
};

const dismissReports = async ({ actor, organizationId, postId }) => {
  const post = await loadPostSite({ organizationId, postId });
  assertMayAccessResidents(
    await actorStanding(actor, organizationId),
    post.branchId,
  );

  const closed = await FamilyPostReport.updateMany(
    { postId: post._id, status: FamilyPostReportStatus.OPEN },
    {
      $set: {
        status: FamilyPostReportStatus.DISMISSED,
        resolvedBy: actor._id,
        resolvedAt: new Date(),
      },
    },
  );
  return { postId: post._id, dismissed: closed.modifiedCount ?? 0 };
};

const actionReports = ({ postId, actorId }) =>
  FamilyPostReport.updateMany(
    { postId, status: FamilyPostReportStatus.OPEN },
    {
      $set: {
        status: FamilyPostReportStatus.ACTIONED,
        resolvedBy: actorId,
        resolvedAt: new Date(),
      },
    },
  );

const getAttention = async ({ organizationId, branchId }) => {
  const scope = { organizationId: toObjectId(organizationId) };
  if (branchId) scope.branchId = toObjectId(branchId);

  const [[uploads], [reported]] = await Promise.all([
    FamilyUpload.aggregate([
      { $match: { ...scope, status: FamilyUploadStatus.PENDING } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          oldestAt: { $min: "$createdAt" },
        },
      },
    ]),
    FamilyPostReport.aggregate([
      { $match: { ...scope, status: FamilyPostReportStatus.OPEN } },
      {
        $group: {
          _id: "$postId",
          reports: { $sum: 1 },
          oldestAt: { $min: "$createdAt" },
        },
      },
      {
        $group: {
          _id: null,
          posts: { $sum: 1 },
          reports: { $sum: "$reports" },
          oldestAt: { $min: "$oldestAt" },
        },
      },
    ]),
  ]);

  const pendingUploads = {
    count: uploads?.count ?? 0,
    oldestAt: uploads?.oldestAt ?? null,
  };
  const reportedPosts = {
    count: reported?.posts ?? 0,
    reports: reported?.reports ?? 0,
    oldestAt: reported?.oldestAt ?? null,
  };
  return {
    pendingUploads,
    reportedPosts,
    total: pendingUploads.count + reportedPosts.count,
  };
};

const getStaffActivity = async ({ organizationId, branchId, days }) => {
  const span = days === undefined ? DEFAULT_ACTIVITY_DAYS : Number(days);
  if (!Number.isInteger(span) || span < 1 || span > MAX_ACTIVITY_DAYS)
    throw new AppError("invalid_days", 400);

  const scope = {
    organizationId: toObjectId(organizationId),
    status: FamilyPostStatus.PUBLISHED,
    createdAt: { $gte: new Date(Date.now() - span * DAY_MS) },
  };
  if (branchId) scope.branchId = toObjectId(branchId);

  const rows = await FamilyPost.aggregate([
    { $match: scope },
    {
      $group: {
        _id: "$authorId",
        posts: { $sum: 1 },
        organizationId: { $first: "$organizationId" },
      },
    },
    { $addFields: { authorId: "$_id" } },
    { $sort: { posts: -1, _id: 1 } },
    { $limit: MAX_ACTIVITY_AUTHORS },
    ...joinOne({
      from: User,
      localField: "authorId",
      as: "author",
      optional: true,
    }),
    ...authorRoleStages(),
    {
      $project: {
        _id: 0,
        authorId: 1,
        authorName: { $ifNull: ["$author.name", ""] },
        authorPhotoUrl: { $ifNull: ["$author.profileIcon", ""] },
        authorRole: 1,
        posts: 1,
      },
    },
  ]);

  return { days: span, authors: rows };
};

module.exports = {
  decoratePosts,
  dismissReports,
  actionReports,
  getAttention,
  getStaffActivity,
};
