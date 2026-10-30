const { Branch } = require("@models/Branch");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyReaction } = require("@models/FamilyReaction");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const {
  FamilyGazetteItemStatus,
  FamilyNewsletterStatus,
  FamilyPostStatus,
  FamilyUploadStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/residents/residentAccess");
const {
  toObjectId,
  joinOne,
} = require("@appServices/family/familyPipeline");
const { getAttention } = require("./familyWallActivityService");
const { getWallGazetteCard } = require("./familyGazetteCard");

const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const activityOf = async ({ scope, since }) => {
  const [uploads, [posts], [reactions]] = await Promise.all([
    FamilyUpload.aggregate([
      { $match: { ...scope, createdAt: { $gte: since } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    FamilyPost.aggregate([
      {
        $match: {
          ...scope,
          status: FamilyPostStatus.PUBLISHED,
          createdAt: { $gte: since },
        },
      },
      { $count: "count" },
    ]),
    FamilyReaction.aggregate([
      { $match: { createdAt: { $gte: since } } },
      ...joinOne({ from: FamilyPost, localField: "postId", as: "post" }),
      {
        $match: Object.fromEntries(
          Object.entries(scope).map(([key, value]) => [`post.${key}`, value]),
        ),
      },
      { $count: "count" },
    ]),
  ]);

  const byStatus = Object.fromEntries(uploads.map((row) => [row._id, row.count]));
  const approved = byStatus[FamilyUploadStatus.APPROVED] ?? 0;
  const pending = byStatus[FamilyUploadStatus.PENDING] ?? 0;
  const notApproved = byStatus[FamilyUploadStatus.REJECTED] ?? 0;
  return {
    uploads: {
      total: approved + pending + notApproved,
      approved,
      pending,
      notApproved,
    },
    wallPosts: posts?.count ?? 0,
    reactions: reactions?.count ?? 0,
  };
};

const nextNewsletterOf = async ({ scope }) => {
  const [newsletter] = await FamilyNewsletter.aggregate([
    {
      $match: {
        ...scope,
        status: {
          $in: [
            FamilyNewsletterStatus.DRAFT,
            FamilyNewsletterStatus.SCHEDULED,
            FamilyNewsletterStatus.SENDING,
          ],
        },
      },
    },
    { $sort: { periodEnd: 1, _id: 1 } },
    { $limit: 1 },
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    {
      $project: {
        _id: 0,
        newsletterId: "$_id",
        branchId: 1,
        homeName: { $ifNull: ["$branch.name", ""] },
        issueNumber: 1,
        title: 1,
        status: 1,
        dueAt: { $ifNull: ["$sendAt", "$periodEnd"] },
      },
    },
  ]);
  return newsletter ?? null;
};

const gazetteProgressOf = async ({ scope }) => {
  const issues = await FamilyGazetteIssue.aggregate([
    { $match: scope },
    { $sort: { periodStart: -1, _id: -1 } },
    { $group: { _id: "$branchId", issueId: { $first: "$_id" } } },
  ]);
  if (!issues.length)
    return { total: 0, building: 0, failed: 0, ready: 0, printed: 0, toGive: 0 };

  const [row] = await FamilyGazetteItem.aggregate([
    { $match: { issueId: { $in: issues.map((issue) => issue.issueId) } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        building: {
          $sum: { $cond: [{ $eq: ["$status", FamilyGazetteItemStatus.BUILDING] }, 1, 0] },
        },
        failed: {
          $sum: { $cond: [{ $eq: ["$status", FamilyGazetteItemStatus.FAILED] }, 1, 0] },
        },
        ready: {
          $sum: { $cond: [{ $eq: ["$status", FamilyGazetteItemStatus.READY] }, 1, 0] },
        },
        printed: {
          $sum: { $cond: [{ $eq: ["$status", FamilyGazetteItemStatus.PRINTED] }, 1, 0] },
        },
        toGive: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", FamilyGazetteItemStatus.PRINTED] },
                  { $eq: ["$givenAt", null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const { _id, ...progress } = row ?? {};
  return { total: 0, building: 0, failed: 0, ready: 0, printed: 0, toGive: 0, ...progress };
};

const checklistOf = ({ attention, gazette, progress }) => {
  const toBuild = progress.building + progress.failed;
  const toPrint = progress.ready + progress.toGive;
  return [
    {
      key: "moderation",
      count: attention.pendingUploads.count,
      done: attention.pendingUploads.count === 0,
    },
    {
      key: "noContent",
      count: gazette?.residents?.noContent ?? 0,
      done: (gazette?.residents?.noContent ?? 0) === 0,
    },
    {
      key: "generate",
      count: toBuild,
      done: progress.total > 0 && toBuild === 0,
    },
    {
      key: "printAndGive",
      count: toPrint,
      done: progress.total > 0 && toPrint === 0 && progress.printed > 0,
    },
  ];
};

const getOverview = async ({ actor, organizationId, branchId, days }) => {
  const span = days === undefined ? DEFAULT_DAYS : Number(days);
  if (!Number.isInteger(span) || span < 1 || span > MAX_DAYS)
    throw new AppError("invalid_days", 400);

  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayAccessResidents(standing, scopedBranchId);

  const scope = { organizationId: toObjectId(organizationId) };
  let site = null;
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    scope.branchId = toObjectId(scopedBranchId);
    const [branch] = await Branch.aggregate([
      { $match: { _id: scope.branchId } },
      { $project: { name: 1 } },
    ]);
    site = { branchId: branch._id, name: branch.name };
  }

  const now = new Date();
  const [attention, gazette, activity, nextNewsletter, progress] =
    await Promise.all([
      getAttention({ organizationId, branchId: scopedBranchId }),
      getWallGazetteCard({ organizationId, branchId: scopedBranchId, now }),
      activityOf({ scope, since: new Date(now.getTime() - span * DAY_MS) }),
      nextNewsletterOf({ scope }),
      gazetteProgressOf({ scope }),
    ]);

  const residents = gazette?.residents;
  return {
    site,
    stats: {
      uploadsPending: attention.pendingUploads.count,
      reportedPosts: attention.reportedPosts.count,
      residentsWithFamily: residents ? residents.total - residents.noFamily : 0,
      residentsWithNoContent: residents?.noContent ?? 0,
    },
    gazette: gazette?.scheduled
      ? {
          scheduled: true,
          number: gazette.number,
          closesAt: gazette.closesAt,
          closesInDays: gazette.closesInDays,
          state: gazette.state,
        }
      : { scheduled: false },
    activity: { days: span, ...activity, nextNewsletter },
    checklist: checklistOf({ attention, gazette, progress }),
  };
};

module.exports = { getOverview };
