const { Organization } = require("@models/Organization");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { OrganizationUsage } = require("@models/OrganizationUsage");
const { BranchUsage } = require("@models/BranchUsage");
const { PlatformBilling, SETTINGS_KEY } = require("@models/PlatformBilling");
const { MembershipRole, OrganizationStatus } = require("@models/domainEnums");
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

const MAY_EDIT_ORGANIZATION = [MembershipRole.OWNER, MembershipRole.SUPER_ADMIN];

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

const usageStages = (planLimitGb, { usageModel = OrganizationUsage, foreignField = "organizationId" } = {}) => [
  {
    $lookup: {
      from: usageModel.collection.name,
      localField: "_id",
      foreignField,
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
      planLimitGb: { $literal: planLimitGb > 0 ? planLimitGb : null },
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

const getBilling = async () => {
  const billing = await PlatformBilling.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true, new: true },
  ).lean();
  return {
    planLimitGb: billing.planLimitGb ?? null,
    baseTierGbp: billing.baseTierGbp,
    overageGbpPerGb: billing.overageGbpPerGb,
  };
};

const figuresOf = (row) => {
  const usagePercent = row.usagePercent === null ? null : Math.round(row.usagePercent * 10) / 10;
  const status = statusOf(usagePercent);
  return {
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
    unmeasured: row.unmeasured,
  };
};

const rowOf = (row, { canEdit }) => ({
  organizationId: row._id,
  name: row.name,
  owner: { name: row.ownerName || "", email: row.ownerEmail || "" },
  ...figuresOf(row),
  emergencyNotifyOffsite: Boolean(row.emergencyNotifyOffsite),
  measuring: Boolean(row.measuringSince),
  canEdit,
});

const branchRowOf = (row) => ({
  branchId: row._id,
  organizationId: row.organizationId,
  name: row.name,
  manager: { name: row.managerName || "", email: row.managerEmail || "" },
  ...figuresOf(row),
  canEdit: false,
});

const summaryOf = (totals, prices, planLimitGb) => {
  const used = totals.imageBytes + totals.fileBytes;
  const overageGb = toGb(totals.overageBytes);
  const overageChargeGbp = Math.round(overageGb * prices.overageGbpPerGb * 100) / 100;
  return {
    activeOrganizations: totals.organizations,
    totalUsedGb: toGb(used),
    planLimitGb,
    totalPlanGb: totals.limitBytes > 0 ? toGb(totals.limitBytes) : null,
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

const totalsOf = async (model, match, stages) => {
  const [totals] = await model.aggregate([
    { $match: match },
    ...stages,
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

const organizationStages = (planLimitGb) => [
  ...joinOne({ from: User, localField: "ownerUserId", as: "owner", optional: true }),
  ...usageStages(planLimitGb),
  { $addFields: { ownerName: "$owner.name", ownerEmail: "$owner.email" } },
];

const branchStages = (planLimitGb) => [
  ...joinOne({ from: User, localField: "managerUserId", as: "manager", optional: true }),
  ...usageStages(planLimitGb, { usageModel: BranchUsage, foreignField: "branchId" }),
  { $addFields: { managerName: "$manager.name", managerEmail: "$manager.email" } },
];

const FIGURES = {
  name: 1, planLimitGb: 1, usagePercent: 1, usedBytes: 1,
  imageBytes: 1, imageCount: 1, fileBytes: 1, fileCount: 1,
  measuredAt: 1, unmeasured: 1,
};

const searchOn = (text, fields) =>
  text
    ? [{ $match: { $or: fields.map((field) => ({ [field]: { $regex: text, $options: "i" } })) } }]
    : [];

const pageOf = async ({ model, scope, stages, search, sort, skip, limit, project }) => {
  const [result] = await model.aggregate([
    { $match: scope },
    ...stages,
    ...search,
    {
      $facet: {
        data: [{ $sort: SORTS[sort] }, { $skip: skip }, { $limit: limit }, { $project: project }],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);
  return result;
};

const listUsage = async ({
  actor,
  role,
  branchId,
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
  const orgWide = platform || MAY_EDIT_ORGANIZATION.includes(role);
  if (!orgWide && !isValidObjectId(branchId)) throw new AppError("insufficient_role", 403);

  const text = searchText(keyword);
  const { planLimitGb, ...prices } = await getBilling();
  const orgStages = organizationStages(planLimitGb);
  const orgProject = { ...FIGURES, ownerName: 1, ownerEmail: 1, measuringSince: 1,
    emergencyNotifyOffsite: { $ifNull: ["$settings.emergencyNotifyOffsite", false] } };
  const paging = { sort, skip, limit };

  if (platform) {
    const scope = { status: OrganizationStatus.ACTIVE };
    const listed = { ...scope };
    if (filterOrganizationId) listed._id = toObjectId(filterOrganizationId);

    const [result, totals, options] = await Promise.all([
      pageOf({
        model: Organization, scope: listed, stages: orgStages, project: orgProject, ...paging,
        search: searchOn(text, ["name", "ownerName", "ownerEmail"]),
      }),
      totalsOf(Organization, scope, orgStages),
      Organization.aggregate([{ $match: scope }, { $sort: { name: 1 } }, { $project: { name: 1 } }]),
    ]);
    return {
      data: result.data.map((row) => rowOf(row, { canEdit: true })),
      meta: {
        ...generateMeta(page, limit, facetCount(result.totalCount)),
        summary: summaryOf(totals, prices, planLimitGb),
        organizations: options.map((org) => ({ organizationId: org._id, name: org.name })),
      },
    };
  }

  const organization = toObjectId(organizationId);
  const stages = branchStages(planLimitGb);
  const scope = orgWide
    ? { organizationId: organization }
    : { organizationId: organization, _id: toObjectId(branchId) };

  const [result, branchTotals, organizationTotals, [organizationRow]] = await Promise.all([
    pageOf({
      model: Branch, scope, stages, project: { ...FIGURES, organizationId: 1, managerName: 1, managerEmail: 1 }, ...paging,
      search: searchOn(text, ["name", "managerName", "managerEmail"]),
    }),
    orgWide ? null : totalsOf(Branch, scope, stages),
    orgWide ? totalsOf(Organization, { _id: organization }, orgStages) : null,
    orgWide
      ? Organization.aggregate([{ $match: { _id: organization } }, ...orgStages, { $project: orgProject }])
      : [],
  ]);

  return {
    data: result.data.map(branchRowOf),
    meta: {
      ...generateMeta(page, limit, facetCount(result.totalCount)),
      summary: summaryOf(branchTotals || organizationTotals, prices, planLimitGb),
      ...(organizationRow ? { organization: rowOf(organizationRow, { canEdit: true }) } : {}),
    },
  };
};

const updateSettings = async ({ actor, planLimitGb, baseTierGbp, overageGbpPerGb }) => {
  requirePlatformAdmin(actor);
  const set = {};

  if (planLimitGb !== undefined) {
    const valid =
      planLimitGb === null ||
      (typeof planLimitGb === "number" &&
        Number.isFinite(planLimitGb) &&
        planLimitGb > 0 &&
        planLimitGb <= MAX_PLAN_LIMIT_GB);
    if (!valid) throw new AppError("invalid_plan_limit", 400, { max: MAX_PLAN_LIMIT_GB });
    set.planLimitGb = planLimitGb;
  }
  for (const [field, value] of Object.entries({ baseTierGbp, overageGbpPerGb })) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PRICE_GBP)
      throw new AppError("invalid_billing_price", 400, { max: MAX_PRICE_GBP });
    set[field] = value;
  }
  if (!Object.keys(set).length) throw new AppError("invalid_billing_settings", 400);

  await PlatformBilling.updateOne({ key: SETTINGS_KEY }, { $set: set }, { upsert: true });
  return getBilling();
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
    const { branches, ...totals } = await measureOrganization(organizationId);
    await OrganizationUsage.updateOne(
      { organizationId: toObjectId(organizationId) },
      { $set: { ...totals, measuredAt: now, measuringSince: null } },
    );
    if (branches.length)
      await BranchUsage.bulkWrite(
        branches.map(({ branchId, ...figures }) => ({
          updateOne: {
            filter: { branchId: toObjectId(branchId) },
            update: {
              $set: { ...figures, organizationId: toObjectId(organizationId), measuredAt: now },
            },
            upsert: true,
          },
        })),
        { ordered: false },
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
  updateSettings,
  recalculateOrganization,
  recalculateAll,
  SORTS,
};
