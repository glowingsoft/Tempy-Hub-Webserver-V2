const { Organization } = require("@models/Organization");
const { User } = require("@models/UserModel");
const { OrganizationUsage } = require("@models/OrganizationUsage");
const { PlatformBilling, SETTINGS_KEY } = require("@models/PlatformBilling");
const { OrganizationStatus } = require("@models/domainEnums");
const { searchText } = require("@utils/familyQuery");
const { generateMeta } = require("@utils/responseUtil");
const { facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, isValidObjectId, joinOne } = require("@appServices/family/familyPipeline");
const { measureOrganization } = require("./storageMeasure");

const GB = 1024 ** 3;
const MAX_PLAN_LIMIT_GB = 1000000;
const MAX_PRICE_GBP = 100000;
const STALE_MEASUREMENT_MS = 30 * 60 * 1000;

const Usage = { NORMAL: "normal", MODERATE: "moderate", HIGH: "high", OVER: "overPlan", NO_LIMIT: "noLimit" };
const USAGE_LABELS = {
  [Usage.NORMAL]: "Normal",
  [Usage.MODERATE]: "Moderate",
  [Usage.HIGH]: "High",
  [Usage.OVER]: "Over plan",
  [Usage.NO_LIMIT]: "No limit set",
};
const MODERATE_FROM_PERCENT = 60;
const HIGH_FROM_PERCENT = 90;

const SORTS = {
  usedDesc: { usedBytes: -1, name: 1, _id: 1 },
  usedAsc: { usedBytes: 1, name: 1, _id: 1 },
  percentDesc: { usagePercent: -1, name: 1, _id: 1 },
  name: { name: 1, _id: 1 },
};

const isPlatformAdmin = (actor) => actor?.userType === "admin";

const requirePlatformAdmin = (actor) => {
  if (!isPlatformAdmin(actor)) throw new AppError("insufficient_role", 403);
};

const toGb = (bytes) => Math.round((bytes / GB) * 100) / 100;
const percent = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

const statusOf = (usagePercent) => {
  if (usagePercent === null) return Usage.NO_LIMIT;
  if (usagePercent > 100) return Usage.OVER;
  if (usagePercent >= HIGH_FROM_PERCENT) return Usage.HIGH;
  if (usagePercent >= MODERATE_FROM_PERCENT) return Usage.MODERATE;
  return Usage.NORMAL;
};

/** What each organization row needs: its owner, what it stores, and how much of its plan that is. */
const usageStages = [
  ...joinOne({ from: User, localField: "ownerUserId", as: "owner", optional: true }),
  {
    $lookup: {
      from: OrganizationUsage.collection.name,
      localField: "_id",
      foreignField: "organizationId",
      as: "usage",
    },
  },
  { $unwind: { path: "$usage", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      imageBytes: { $ifNull: ["$usage.imageBytes", 0] },
      imageCount: { $ifNull: ["$usage.imageCount", 0] },
      fileBytes: { $ifNull: ["$usage.fileBytes", 0] },
      fileCount: { $ifNull: ["$usage.fileCount", 0] },
      measuredAt: { $ifNull: ["$usage.measuredAt", null] },
      measuringSince: { $ifNull: ["$usage.measuringSince", null] },
      unmeasured: { $ifNull: ["$usage.unmeasured", 0] },
      planLimitGb: {
        $cond: [{ $gt: ["$billing.planLimitGb", 0] }, "$billing.planLimitGb", null],
      },
    },
  },
  {
    $addFields: {
      usedBytes: { $add: ["$imageBytes", "$fileBytes"] },
      limitBytes: {
        $cond: [{ $gt: ["$planLimitGb", 0] }, { $multiply: ["$planLimitGb", GB] }, null],
      },
    },
  },
  {
    $addFields: {
      usagePercent: {
        $cond: [
          { $gt: ["$limitBytes", 0] },
          { $multiply: [{ $divide: ["$usedBytes", "$limitBytes"] }, 100] },
          null,
        ],
      },
    },
  },
];

const getPrices = async () => {
  const prices = await PlatformBilling.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true, new: true },
  ).lean();
  return { baseTierGbp: prices.baseTierGbp, overageGbpPerGb: prices.overageGbpPerGb };
};

const rowOf = (row, { canEdit }) => {
  const usagePercent = row.usagePercent === null ? null : Math.round(row.usagePercent * 10) / 10;
  const status = statusOf(usagePercent);
  return {
    organizationId: row._id,
    name: row.name,
    owner: { name: row.ownerName || "", email: row.ownerEmail || "" },
    usedGb: toGb(row.usedBytes),
    planLimitGb: row.planLimitGb,
    usagePercent,
    status,
    statusLabel: USAGE_LABELS[status],
    images: {
      gb: toGb(row.imageBytes),
      percentOfUsed: percent(row.imageBytes, row.usedBytes),
      count: row.imageCount,
    },
    files: {
      gb: toGb(row.fileBytes),
      percentOfUsed: percent(row.fileBytes, row.usedBytes),
      count: row.fileCount,
    },
    measuredAt: row.measuredAt,
    measuring: Boolean(row.measuringSince),
    unmeasured: row.unmeasured,
    canEdit,
  };
};

const summaryOf = (totals, prices) => {
  const used = totals.imageBytes + totals.fileBytes;
  const overageGb = toGb(totals.overageBytes);
  const overageChargeGbp = Math.round(overageGb * prices.overageGbpPerGb * 100) / 100;
  return {
    activeOrganizations: totals.organizations,
    totalUsedGb: toGb(used),
    planLimitGb: toGb(totals.limitBytes),
    quotaPercent: totals.limitBytes > 0 ? percent(totals.limitUsedBytes, totals.limitBytes) : null,
    images: { gb: toGb(totals.imageBytes), percentOfTotal: percent(totals.imageBytes, used), count: totals.imageCount },
    files: { gb: toGb(totals.fileBytes), percentOfTotal: percent(totals.fileBytes, used), count: totals.fileCount },
    billing: {
      status: totals.organizationsOver ? "overPlan" : "withinPlan",
      label: totals.organizationsOver ? "Over Plan" : "Within Plan",
      organizationsOver: totals.organizationsOver,
      overageGb,
      overageChargeGbp,
      ...prices,
    },
    lastMeasuredAt: totals.lastMeasuredAt,
  };
};

const EMPTY_TOTALS = {
  organizations: 0, imageBytes: 0, imageCount: 0, fileBytes: 0, fileCount: 0,
  limitBytes: 0, limitUsedBytes: 0, overageBytes: 0, organizationsOver: 0, lastMeasuredAt: null,
};

const totalsOf = async (match) => {
  const [totals] = await Organization.aggregate([
    { $match: match },
    ...usageStages,
    {
      $group: {
        _id: null,
        organizations: { $sum: 1 },
        imageBytes: { $sum: "$imageBytes" },
        imageCount: { $sum: "$imageCount" },
        fileBytes: { $sum: "$fileBytes" },
        fileCount: { $sum: "$fileCount" },
        limitBytes: { $sum: "$limitBytes" },
        limitUsedBytes: {
          $sum: { $cond: [{ $gt: ["$limitBytes", 0] }, "$usedBytes", 0] },
        },
        overageBytes: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ["$limitBytes", 0] }, { $gt: ["$usedBytes", "$limitBytes"] }] },
              { $subtract: ["$usedBytes", "$limitBytes"] },
              0,
            ],
          },
        },
        organizationsOver: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ["$limitBytes", 0] }, { $gt: ["$usedBytes", "$limitBytes"] }] },
              1,
              0,
            ],
          },
        },
        lastMeasuredAt: { $max: "$measuredAt" },
      },
    },
  ]);
  return totals ? { ...EMPTY_TOTALS, ...totals } : EMPTY_TOTALS;
};

/**
 * The Billing & Usage screen. A platform admin sees every active organization (and can pick one); everyone else
 * sees their own. The cards cover everything in scope; the table follows the filter and the search.
 */
const listUsage = async ({
  actor,
  organizationId,
  filterOrganizationId,
  keyword,
  sort = "usedDesc",
  page,
  limit,
  skip,
}) => {
  if (!Object.prototype.hasOwnProperty.call(SORTS, sort))
    throw new AppError("invalid_usage_sort", 400);

  const platform = isPlatformAdmin(actor);
  const scope = platform
    ? { status: OrganizationStatus.ACTIVE }
    : { _id: toObjectId(organizationId) };
  const listed = { ...scope };
  if (platform && filterOrganizationId) listed._id = toObjectId(filterOrganizationId);

  const text = searchText(keyword);
  const search = text
    ? [
        {
          $match: {
            $or: [
              { name: { $regex: text, $options: "i" } },
              { ownerName: { $regex: text, $options: "i" } },
              { ownerEmail: { $regex: text, $options: "i" } },
            ],
          },
        },
      ]
    : [];

  const [[result], totals, prices, options] = await Promise.all([
    Organization.aggregate([
      { $match: listed },
      ...usageStages,
      { $addFields: { ownerName: "$owner.name", ownerEmail: "$owner.email" } },
      ...search,
      {
        $facet: {
          data: [
            { $sort: SORTS[sort] },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                name: 1, ownerName: 1, ownerEmail: 1, planLimitGb: 1, usagePercent: 1,
                usedBytes: 1, imageBytes: 1, imageCount: 1, fileBytes: 1, fileCount: 1,
                measuredAt: 1, measuringSince: 1, unmeasured: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ]),
    totalsOf(scope),
    getPrices(),
    platform
      ? Organization.aggregate([
          { $match: scope },
          { $sort: { name: 1 } },
          { $project: { name: 1 } },
        ])
      : [],
  ]);

  return {
    data: result.data.map((row) => rowOf(row, { canEdit: platform })),
    meta: {
      ...generateMeta(page, limit, facetCount(result.totalCount)),
      summary: summaryOf(totals, prices),
      ...(platform
        ? { organizations: options.map((org) => ({ organizationId: org._id, name: org.name })) }
        : {}),
    },
  };
};

const requireOrganization = async (organizationId) => {
  if (!isValidObjectId(organizationId))
    throw new AppError("organization_not_found", 404);
  const [organization] = await Organization.aggregate([
    { $match: { _id: toObjectId(organizationId) } },
    { $project: { _id: 1 } },
  ]);
  if (!organization) throw new AppError("organization_not_found", 404);
  return organization._id;
};

const rowFor = async (organizationId) => {
  const [row] = await Organization.aggregate([
    { $match: { _id: toObjectId(organizationId) } },
    ...usageStages,
    { $addFields: { ownerName: "$owner.name", ownerEmail: "$owner.email" } },
  ]);
  return rowOf(row, { canEdit: true });
};

/** The pencil: set the storage an organization's plan includes, or clear it with null. */
const updatePlan = async ({ actor, organizationId, planLimitGb }) => {
  requirePlatformAdmin(actor);
  const id = await requireOrganization(organizationId);

  const cleared = planLimitGb === null;
  if (
    !cleared &&
    (typeof planLimitGb !== "number" ||
      !Number.isFinite(planLimitGb) ||
      planLimitGb <= 0 ||
      planLimitGb > MAX_PLAN_LIMIT_GB)
  )
    throw new AppError("invalid_plan_limit", 400, { max: MAX_PLAN_LIMIT_GB });

  await Organization.updateOne({ _id: id }, { $set: { "billing.planLimitGb": planLimitGb } });
  return rowFor(id);
};

/** The platform prices shown on the Billing Readiness card. */
const updatePrices = async ({ actor, baseTierGbp, overageGbpPerGb }) => {
  requirePlatformAdmin(actor);
  const set = {};
  for (const [field, value] of Object.entries({ baseTierGbp, overageGbpPerGb })) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PRICE_GBP)
      throw new AppError("invalid_billing_price", 400, { max: MAX_PRICE_GBP });
    set[field] = value;
  }
  if (!Object.keys(set).length) throw new AppError("invalid_billing_price", 400, { max: MAX_PRICE_GBP });

  await PlatformBilling.updateOne({ key: SETTINGS_KEY }, { $set: set }, { upsert: true });
  return getPrices();
};

/** Takes the organization's measurement slot; false when one is already running (a stuck one is taken over after 30 minutes). */
const claimMeasurement = async (organizationId, now) => {
  try {
    const claimed = await OrganizationUsage.findOneAndUpdate(
      {
        organizationId: toObjectId(organizationId),
        $or: [
          { measuringSince: null },
          { measuringSince: { $lt: new Date(now.getTime() - STALE_MEASUREMENT_MS) } },
        ],
      },
      { $set: { measuringSince: now } },
      { upsert: true, new: true },
    );
    return Boolean(claimed);
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
};

const runClaimedMeasurement = async (organizationId, now) => {
  try {
    const totals = await measureOrganization(organizationId);
    await OrganizationUsage.updateOne(
      { organizationId: toObjectId(organizationId) },
      { $set: { ...totals, measuredAt: now, measuringSince: null } },
    );
  } catch (error) {
    await OrganizationUsage.updateOne(
      { organizationId: toObjectId(organizationId) },
      { $set: { measuringSince: null } },
    );
    throw error;
  }
};

/** Measures one organization now; used by the nightly job. Returns false when a measurement was already running. */
const recalculateOrganization = async (organizationId, now = new Date()) => {
  if (!(await claimMeasurement(organizationId, now))) return false;
  await runClaimedMeasurement(organizationId, now);
  return true;
};

/** The Recalculate button: starts a measurement and answers at once; the numbers update when it finishes. */
const startRecalculation = async ({
  actor,
  organizationId,
  background = true,
  now = new Date(),
}) => {
  requirePlatformAdmin(actor);
  const id = await requireOrganization(organizationId);
  if (!(await claimMeasurement(id, now)))
    throw new AppError("usage_recalculating", 409);

  const run = runClaimedMeasurement(id, now);
  if (!background) await run;
  else run.catch((error) => console.error("usage recalculation failed", error.message));
  return { organizationId: id, started: true };
};

const recalculateAll = async () => {
  const organizations = await Organization.aggregate([
    { $match: { status: OrganizationStatus.ACTIVE } },
    { $project: { _id: 1 } },
  ]);
  for (const { _id } of organizations) {
    try {
      await recalculateOrganization(_id);
    } catch (error) {
      console.error("usage measurement failed", String(_id), error.message);
    }
  }
  return organizations.length;
};

module.exports = {
  listUsage,
  updatePlan,
  updatePrices,
  startRecalculation,
  recalculateOrganization,
  recalculateAll,
  SORTS,
};
