const mongoose = require("mongoose");
const { PeepRecord } = require("@models/PeepRecord");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { FloorPlan } = require("@models/FloorPlan");
const { FloorPlanPin } = require("@models/FloorPlanPin");
const { AppError } = require("@services/_errors/AppError");
const {
  AdmissionStatus,
  CareLevel,
  MembershipRole,
  PeepConsentStatus,
} = require("@models/domainEnums");
const { facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  duplicateKey,
} = require("./floorPlanAccess");

const toOid = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError("invalid_id", 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const trimText = (value) =>
  value == null ? undefined : String(value).trim();

const isAllFilter = (value) =>
  value == null || value === "" || String(value).trim().toLowerCase() === "all";

const PEEP_LEVELS = Object.values(CareLevel);

const emptyPeepLevelCounts = () =>
  Object.fromEntries(PEEP_LEVELS.map((level) => [level, 0]));

/** Tab counts ignore the selected level so each total stays independent of that filter. */
const peepLevelCountsFromGroup = (rows) => {
  const counts = emptyPeepLevelCounts();
  for (const row of rows || []) {
    if (counts[row._id] != null) counts[row._id] = row.count;
  }
  return counts;
};

const parsePeepLevel = (value, { required = false } = {}) => {
  if (isAllFilter(value)) {
    if (required) throw new AppError("invalid_peep_level", 400);
    return undefined;
  }
  const level = String(value).trim().toLowerCase();
  if (!PEEP_LEVELS.includes(level)) {
    throw new AppError("invalid_peep_level", 400);
  }
  return level;
};

const defaultReviewDueAt = () => {
  const due = new Date();
  due.setFullYear(due.getFullYear() + 1);
  return due;
};

const recordShapeStages = [
  {
    $lookup: {
      from: Resident.collection.name,
      localField: "residentId",
      foreignField: "_id",
      as: "_resident",
      pipeline: [
        {
          $project: {
            name: 1,
            email: 1,
            photoUrl: 1,
            roomNumber: 1,
            branchId: 1,
            admissionStatus: 1,
          },
        },
      ],
    },
  },
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      as: "_branch",
      pipeline: [{ $project: { name: 1, code: 1 } }],
    },
  },
  {
    $lookup: {
      from: FloorPlanPin.collection.name,
      localField: "residentId",
      foreignField: "residentId",
      as: "_pin",
      pipeline: [
        { $sort: { updatedAt: -1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: FloorPlan.collection.name,
            localField: "floorPlanId",
            foreignField: "_id",
            as: "_plan",
            pipeline: [{ $project: { name: 1, branchId: 1 } }],
          },
        },
        {
          $addFields: {
            floorPlan: { $arrayElemAt: ["$_plan", 0] },
          },
        },
        { $project: { _plan: 0 } },
      ],
    },
  },
  {
    $addFields: {
      resident: { $arrayElemAt: ["$_resident", 0] },
      branch: { $arrayElemAt: ["$_branch", 0] },
      pin: { $arrayElemAt: ["$_pin", 0] },
    },
  },
  {
    $addFields: {
      name: "$resident.name",
      email: "$resident.email",
      roomNumber: "$resident.roomNumber",
      floorPlanId: "$pin.floorPlanId",
      floor: "$pin.floorPlan.name",
    },
  },
  { $project: { _resident: 0, _branch: 0, _pin: 0 } },
];

const loadShapedRecord = async (peepRecordId, organizationId) => {
  const [row] = await PeepRecord.aggregate([
    {
      $match: {
        _id: toOid(peepRecordId),
        organizationId: toOid(organizationId),
      },
    },
    ...recordShapeStages,
  ]);
  if (!row) throw new AppError("peep_record_not_found", 404);
  return row;
};

const assertMayAccessRecord = async (actor, organizationId, branchId, { manage }) => {
  const standing = await actorStanding(actor, organizationId);
  if (manage) {
    assertMayManageStaff(standing, branchId);
  } else if (
    standing.role === MembershipRole.SITE_MANAGER &&
    String(standing.branchId) !== String(branchId)
  ) {
    throw new AppError("outside_managed_branch", 403);
  }
  await assertBranchInOrganization(branchId, organizationId);
  return standing;
};

const requireAdmittedResident = async ({
  organizationId,
  residentId,
  branchId,
}) => {
  const resident = await Resident.findOne({
    _id: residentId,
    organizationId,
    admissionStatus: AdmissionStatus.ADMITTED,
  }).lean();
  if (!resident) throw new AppError("resident_not_found", 404);
  if (branchId && String(resident.branchId) !== String(branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }
  return resident;
};

const listPeepRecords = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  keyword,
  peepLevel,
  floorPlanId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const siteId = isAllFilter(branchId) ? null : branchId;
  const scoped = scopeBranchFilter(standing, siteId);
  const match = { organizationId: toOid(organizationId) };
  if (scoped) match.branchId = toOid(scoped);
  else if (siteId) match.branchId = toOid(siteId);

  const level = parsePeepLevel(peepLevel);
  const levelMatch = level ? [{ $match: { peepLevel: level } }] : [];
  const pageStages = [
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: limit },
  ];

  const afterLookups = [];
  const search = keyword != null ? String(keyword).trim() : "";
  if (search) {
    afterLookups.push({
      $match: {
        $or: [
          { "resident.name": { $regex: search, $options: "i" } },
          { "resident.email": { $regex: search, $options: "i" } },
        ],
      },
    });
  }
  if (floorPlanId) {
    afterLookups.push({ $match: { floorPlanId: toOid(floorPlanId) } });
  }

  // Level is on the record, so filter it before the joins. Keyword and floor
  // come from those joins, so they narrow the set first when they are set.
  const narrowFirst = afterLookups.length > 0;
  const [result] = await PeepRecord.aggregate([
    { $match: match },
    ...(narrowFirst ? [...recordShapeStages, ...afterLookups] : []),
    {
      $facet: {
        counts: [{ $group: { _id: "$peepLevel", count: { $sum: 1 } } }],
        data: [
          ...levelMatch,
          ...pageStages,
          ...(narrowFirst ? [] : recordShapeStages),
        ],
        totalCount: [...levelMatch, { $count: "count" }],
      },
    },
  ]);

  const totalRecords = facetCount(result?.totalCount);
  return {
    data: result?.data || [],
    meta: {
      ...generateMeta(page, limit, totalRecords),
      counts: peepLevelCountsFromGroup(result?.counts),
    },
  };
};

const getPeepRecord = async ({ actor, organizationId, peepRecordId }) => {
  const row = await loadShapedRecord(peepRecordId, organizationId);
  await assertMayAccessRecord(actor, organizationId, row.branchId, {
    manage: false,
  });
  return row;
};

const getPeepRecordByResident = async ({
  actor,
  organizationId,
  residentId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const resident = await Resident.findOne({
    _id: residentId,
    organizationId,
  })
    .select("branchId")
    .lean();
  if (!resident) throw new AppError("resident_not_found", 404);

  const scoped = scopeBranchFilter(standing, resident.branchId);
  if (scoped && String(scoped) !== String(resident.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }

  const record = await PeepRecord.findOne({
    residentId,
    organizationId,
  })
    .select("_id")
    .lean();
  if (!record) throw new AppError("peep_record_not_found", 404);
  return loadShapedRecord(record._id, organizationId);
};

const createPeepRecord = async ({
  actor,
  organizationId,
  residentId,
  peepLevel,
  supportNeeds,
  primaryRoute,
  secondaryRoute,
  equipmentRequired,
  responsibleStaff,
  reviewDueAt,
  consentStatus,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const resident = await requireAdmittedResident({
    organizationId,
    residentId,
  });
  const scoped = scopeBranchFilter(standing, resident.branchId);
  assertMayManageStaff(standing, scoped || resident.branchId);
  if (scoped && String(scoped) !== String(resident.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }
  await assertBranchInOrganization(resident.branchId, organizationId);

  const level = parsePeepLevel(peepLevel, { required: true });

  try {
    const created = await PeepRecord.create({
      organizationId,
      residentId: resident._id,
      branchId: resident.branchId,
      peepLevel: level,
      supportNeeds: trimText(supportNeeds) || "",
      primaryRoute: trimText(primaryRoute) || "",
      secondaryRoute: trimText(secondaryRoute) || "",
      equipmentRequired: trimText(equipmentRequired) || "",
      responsibleStaff: trimText(responsibleStaff) || "",
      reviewDueAt: reviewDueAt ? new Date(reviewDueAt) : defaultReviewDueAt(),
      consentStatus: Object.values(PeepConsentStatus).includes(consentStatus)
        ? consentStatus
        : PeepConsentStatus.CONSENT,
    });
    return loadShapedRecord(created._id, organizationId);
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("peep_record_already_exists", 409);
    throw error;
  }
};

const updatePeepRecord = async ({
  actor,
  organizationId,
  peepRecordId,
  peepLevel,
  supportNeeds,
  primaryRoute,
  secondaryRoute,
  equipmentRequired,
  responsibleStaff,
  reviewDueAt,
  lastReviewedAt,
  consentStatus,
  mcaBestInterestNotes,
  mobilityNotes,
  assistanceRequired,
  evacuationStrategy,
}) => {
  const existing = await PeepRecord.findOne({
    _id: peepRecordId,
    organizationId,
  });
  if (!existing) throw new AppError("peep_record_not_found", 404);
  await assertMayAccessRecord(actor, organizationId, existing.branchId, {
    manage: true,
  });

  const updates = {};
  const level = parsePeepLevel(peepLevel);
  if (level) updates.peepLevel = level;
  if (supportNeeds !== undefined) updates.supportNeeds = trimText(supportNeeds) || "";
  if (primaryRoute !== undefined) updates.primaryRoute = trimText(primaryRoute) || "";
  if (secondaryRoute !== undefined) {
    updates.secondaryRoute = trimText(secondaryRoute) || "";
  }
  if (equipmentRequired !== undefined) {
    updates.equipmentRequired = trimText(equipmentRequired) || "";
  }
  if (responsibleStaff !== undefined) {
    updates.responsibleStaff = trimText(responsibleStaff) || "";
  }
  if (reviewDueAt !== undefined) {
    updates.reviewDueAt = reviewDueAt ? new Date(reviewDueAt) : null;
  }
  if (lastReviewedAt !== undefined) {
    updates.lastReviewedAt = lastReviewedAt ? new Date(lastReviewedAt) : null;
  }
  if (consentStatus !== undefined) {
    if (!Object.values(PeepConsentStatus).includes(consentStatus)) {
      throw new AppError("invalid_peep_consent_status", 400);
    }
    updates.consentStatus = consentStatus;
  }
  if (mcaBestInterestNotes !== undefined) {
    updates.mcaBestInterestNotes = trimText(mcaBestInterestNotes) || "";
  }
  if (mobilityNotes !== undefined) updates.mobilityNotes = trimText(mobilityNotes) || "";
  if (assistanceRequired !== undefined) {
    updates.assistanceRequired = trimText(assistanceRequired) || "";
  }
  if (evacuationStrategy !== undefined) {
    updates.evacuationStrategy = trimText(evacuationStrategy) || "";
  }

  if (Object.keys(updates).length) {
    Object.assign(existing, updates);
    await existing.save();
  }

  return loadShapedRecord(existing._id, organizationId);
};

const emptyLevels = () => ({
  [CareLevel.LOW]: 0,
  [CareLevel.MEDIUM]: 0,
  [CareLevel.HIGH]: 0,
});

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasUploadedPlanExpr = {
  $gt: [
    {
      $add: [
        { $strLenCP: { $ifNull: ["$imageUrl", ""] } },
        { $strLenCP: { $ifNull: ["$pdfUrl", ""] } },
      ],
    },
    0,
  ],
};

const emptySummary = () => ({
  totals: { ...emptyLevels(), records: 0 },
  floors: { total: 0, uploaded: 0 },
  sites: [],
});

const getPeepFloorSummary = async ({ actor, organizationId, branchId, keyword }) => {
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId);
  const orgId = toOid(organizationId);
  const siteId = scoped || branchId;

  if (siteId) await assertBranchInOrganization(siteId, organizationId);

  const branchMatch = { organizationId: orgId };
  if (siteId) branchMatch._id = toOid(siteId);
  const term = String(keyword || "").trim();
  if (term) branchMatch.name = { $regex: escapeRegex(term), $options: "i" };

  const orgBranches = await Branch.aggregate([
    { $match: branchMatch },
    { $project: { name: 1, code: 1 } },
    { $sort: { name: 1 } },
  ]);
  if (!orgBranches.length) return emptySummary();

  const recordMatch = {
    organizationId: orgId,
    branchId: { $in: orgBranches.map((branch) => branch._id) },
  };

  const [levelRows, planRows] = await Promise.all([
    PeepRecord.aggregate([
      { $match: recordMatch },
      {
        $group: {
          _id: { branchId: "$branchId", peepLevel: "$peepLevel" },
          count: { $sum: 1 },
        },
      },
    ]),
    FloorPlan.aggregate([
      { $match: recordMatch },
      { $sort: { createdAt: 1, name: 1 } },
      {
        $lookup: {
          from: FloorPlanPin.collection.name,
          localField: "_id",
          foreignField: "floorPlanId",
          pipeline: [{ $count: "count" }],
          as: "_pins",
        },
      },
      {
        $project: {
          branchId: 1,
          name: 1,
          pinsCount: { $ifNull: [{ $arrayElemAt: ["$_pins.count", 0] }, 0] },
          status: { $cond: [hasUploadedPlanExpr, "uploaded", "notUploaded"] },
        },
      },
    ]),
  ]);

  const totals = emptyLevels();
  let records = 0;
  for (const row of levelRows) {
    const level = row._id.peepLevel;
    if (totals[level] === undefined) continue;
    totals[level] += row.count;
    records += row.count;
  }

  let floorsTotal = 0;
  let floorsUploaded = 0;
  const floorsByBranch = new Map();
  for (const floor of planRows) {
    const key = String(floor.branchId);
    const summary = floorsByBranch.get(key) || { total: 0, uploaded: 0, floors: [] };
    summary.total += 1;
    floorsTotal += 1;
    if (floor.status === "uploaded") {
      summary.uploaded += 1;
      floorsUploaded += 1;
    }
    summary.floors.push({
      _id: floor._id,
      name: floor.name,
      pinsCount: floor.pinsCount,
      status: floor.status,
    });
    floorsByBranch.set(key, summary);
  }

  const levelsByBranch = new Map();
  for (const row of levelRows) {
    const key = String(row._id.branchId);
    const entry = levelsByBranch.get(key) || emptyLevels();
    if (entry[row._id.peepLevel] !== undefined) {
      entry[row._id.peepLevel] += row.count;
    }
    levelsByBranch.set(key, entry);
  }

  const sites = orgBranches.map((branch) => {
    const id = String(branch._id);
    const levels = levelsByBranch.get(id) || emptyLevels();
    return {
      branch: { _id: branch._id, name: branch.name, code: branch.code },
      levels: {
        ...levels,
        total: levels.low + levels.medium + levels.high,
      },
      floorsSummary: floorsByBranch.get(id) || { total: 0, uploaded: 0, floors: [] },
    };
  });

  return {
    totals: { ...totals, records },
    floors: { total: floorsTotal, uploaded: floorsUploaded },
    sites,
  };
};

module.exports = {
  listPeepRecords,
  getPeepRecord,
  getPeepRecordByResident,
  createPeepRecord,
  updatePeepRecord,
  getPeepFloorSummary,
};
