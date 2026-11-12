const mongoose = require("mongoose");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { EvacCheck } = require("@models/EvacCheck");
const { Branch } = require("@models/Branch");
const { AttendanceDay } = require("@models/AttendanceDay");
const { StaffProfile } = require("@models/StaffProfile");
const { Resident } = require("@models/Resident");
const { VisitSession } = require("@models/VisitSession");
const { JobTitle } = require("@models/JobTitle");
const { ExternalPerson } = require("@models/ExternalPerson");
const { paginateWithFacet, facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const {
  EvacuationType,
  EvacuationStatus,
  FamilyAlertStatus,
  FamilyUpdatePreset,
  EvacPersonKind,
  EvacCheckStatus,
  PresenceStatus,
  VisitSessionStatus,
  ExternalPersonType,
  AdmissionStatus,
  StaffProfileStatus,
  MembershipRole,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  MANAGER_ROLES,
} = require("./evacuationAccess");
const { Organization } = require("@models/Organization");
const { sendFamilyMessage, countFamilies } = require("./evacuationNotify");

const ON_SITE_PRESENCE = [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK];

const COLLECTIONS = {
  branches: Branch.collection.name,
  attendanceDays: AttendanceDay.collection.name,
  staffProfiles: StaffProfile.collection.name,
  residents: Resident.collection.name,
  visitSessions: VisitSession.collection.name,
  externalPeople: ExternalPerson.collection.name,
  users: "users",
  evacChecks: EvacCheck.collection.name,
  evacuations: EvacuationEvent.collection.name,
};

const DRILL_WINDOW_MONTHS = 12;

const EMPTY_KIND_STATS = () => ({
  [EvacPersonKind.STAFF]: { total: 0, safe: 0, missing: 0, unknown: 0 },
  [EvacPersonKind.RESIDENT]: { total: 0, safe: 0, missing: 0, unknown: 0 },
  [EvacPersonKind.VISITOR]: { total: 0, safe: 0, missing: 0, unknown: 0 },
  [EvacPersonKind.CONTRACTOR]: { total: 0, safe: 0, missing: 0, unknown: 0 },
});

const startOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const toObjectId = (value, key = "invalid_id") => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(value);
};

const parseEvacuationType = (type) => {
  if (!Object.values(EvacuationType).includes(type)) {
    throw new AppError("invalid_evacuation_type", 400);
  }
  return type;
};

/** Figma smoke "waiting" is rollcall unknown — not a fourth stored status. */
const CHECK_STATUS_ALIASES = {
  waiting: EvacCheckStatus.UNKNOWN,
};

const parseCheckStatus = (status) => {
  const resolved = CHECK_STATUS_ALIASES[status] || status;
  if (!Object.values(EvacCheckStatus).includes(resolved)) {
    throw new AppError("invalid_evac_check_status", 400);
  }
  return resolved;
};

const parsePersonKind = (personKind) => {
  if (!Object.values(EvacPersonKind).includes(personKind)) {
    throw new AppError("invalid_evac_person_kind", 400);
  }
  return personKind;
};

const emptyRollcallStats = () => ({
  total: 0,
  safe: 0,
  missing: 0,
  unknown: 0,
  byKind: EMPTY_KIND_STATS(),
});

/** Collapse `{ _id: { kind, status }, count }` rows from aggregation into the API stats shape. */
const statsFromGroupedRows = (rows = []) => {
  const stats = emptyRollcallStats();

  for (const row of rows) {
    const kind = row._id?.kind;
    const status = row._id?.status;
    const count = row.count || 0;
    if (!stats.byKind[kind]) continue;

    stats.total += count;
    stats.byKind[kind].total += count;

    if (status === EvacCheckStatus.SAFE) {
      stats.safe += count;
      stats.byKind[kind].safe += count;
    } else if (status === EvacCheckStatus.MISSING) {
      stats.missing += count;
      stats.byKind[kind].missing += count;
    } else {
      stats.unknown += count;
      stats.byKind[kind].unknown += count;
    }
  }

  return stats;
};

const rollcallStatsPipeline = (eventIdExpr = "$_id") => [
  {
    $lookup: {
      from: COLLECTIONS.evacChecks,
      let: { eventId: eventIdExpr },
      pipeline: [
        { $match: { $expr: { $eq: ["$evacuationEventId", "$$eventId"] } } },
        {
          $group: {
            _id: { kind: "$personKind", status: "$status" },
            count: { $sum: 1 },
          },
        },
      ],
      as: "statRows",
    },
  },
];

const branchLookupPipeline = [
  {
    $lookup: {
      from: COLLECTIONS.branches,
      localField: "branchId",
      foreignField: "_id",
      as: "branchDoc",
    },
  },
  { $unwind: { path: "$branchDoc", preserveNullAndEmptyArrays: true } },
];

const familyAlertOf = (stored) => ({
  status: FamilyAlertStatus.NOT_SENT,
  alertedAt: null,
  alertedByUserId: null,
  familiesNotified: 0,
  updates: [],
  allClearAt: null,
  allClearByUserId: null,
  ...(stored || {}),
});

const formatEventDoc = (doc, { includeFamilyAlert = false } = {}) => {
  if (!doc) return null;
  const { branchDoc, statRows, rollcall, familyAlert, ...event } = doc;
  const formatted = {
    ...event,
    ...(includeFamilyAlert ? { familyAlert: familyAlertOf(familyAlert) } : {}),
    branch: branchDoc
      ? {
          _id: branchDoc._id,
          name: branchDoc.name,
          assemblyPoint: branchDoc.assemblyPoint || "",
        }
      : undefined,
  };
  if (rollcall) {
    formatted.rollcallStats = statsFromGroupedRows(rollcall.stats);
    formatted.checks = rollcall.checks || [];
  } else if (statRows) {
    formatted.rollcallStats = statsFromGroupedRows(statRows);
  }
  return formatted;
};

const assertSiteManagerBranch = (standing, branchId) => {
  if (
    standing.role === MembershipRole.SITE_MANAGER &&
    String(scopeBranchFilter(standing, branchId)) !== String(branchId)
  ) {
    throw new AppError("outside_managed_branch", 403);
  }
};

/**
 * People currently on site (staff / residents / visitors / contractors).
 * With branchId: one site. Without: all sites in the org (Owner / SA).
 * Site Manager is always limited to their site.
 */
const getOnSiteSummary = async ({ branchId, organizationId, actor }) => {
  const orgOid = toObjectId(organizationId);
  const standing = actor ? await actorStanding(actor, organizationId) : null;
  const scopedBranchId = standing
    ? scopeBranchFilter(standing, branchId || null)
    : branchId || null;

  const branchFilter = { organizationId: orgOid };
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchFilter._id = toObjectId(scopedBranchId);
  }

  const branches = await Branch.find(branchFilter)
    .select("name assemblyPoint")
    .lean();

  if (scopedBranchId && !branches.length) {
    throw new AppError("branch_not_found", 404);
  }

  const site = scopedBranchId ? branches[0] : null;
  const empty = {
    branchId: site?._id || null,
    branchName: site?.name || null,
    assemblyPoint: site?.assemblyPoint || "",
    counts: {
      staff: 0,
      residents: 0,
      visitors: 0,
      contractors: 0,
      total: 0,
    },
  };

  const branchIds = branches.map((row) => row._id);
  if (!branchIds.length) return empty;

  const workDate = startOfUtcDay(new Date());
  const [staff, residents, visitRows] = await Promise.all([
    AttendanceDay.countDocuments({
      branchId: { $in: branchIds },
      workDate,
      presenceStatus: { $in: ON_SITE_PRESENCE },
      clockOutAt: null,
    }),
    Resident.countDocuments({
      branchId: { $in: branchIds },
      admissionStatus: AdmissionStatus.ADMITTED,
    }),
    VisitSession.aggregate([
      {
        $match: {
          branchId: { $in: branchIds },
          status: VisitSessionStatus.ON_SITE,
          checkOutAt: null,
        },
      },
      { $group: { _id: "$personType", count: { $sum: 1 } } },
    ]),
  ]);

  let visitors = 0;
  let contractors = 0;
  for (const visit of visitRows) {
    if (visit._id === ExternalPersonType.CONTRACTOR) {
      contractors += visit.count;
    } else {
      visitors += visit.count;
    }
  }

  return {
    ...empty,
    counts: {
      staff,
      residents,
      visitors,
      contractors,
      total: staff + residents + visitors + contractors,
    },
  };
};

/**
 * Build seed docs via one Branch aggregation ($facet), then a single insertMany.
 */
const seedRollcallChecks = async (event) => {
  const workDate = startOfUtcDay(event.startedAt || new Date());
  const markedAt = event.startedAt || new Date();
  const eventId = event._id;

  const [seed] = await Branch.aggregate([
    { $match: { _id: event.branchId } },
    {
      $facet: {
        staff: [
          {
            $lookup: {
              from: COLLECTIONS.attendanceDays,
              let: { branchId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$branchId", "$$branchId"] },
                        { $eq: ["$workDate", workDate] },
                        { $in: ["$presenceStatus", ON_SITE_PRESENCE] },
                        { $eq: ["$clockOutAt", null] },
                      ],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    personId: "$staffId",
                    personKind: { $literal: EvacPersonKind.STAFF },
                  },
                },
              ],
              as: "rows",
            },
          },
          { $unwind: "$rows" },
          { $replaceRoot: { newRoot: "$rows" } },
        ],
        residents: [
          {
            $lookup: {
              from: COLLECTIONS.residents,
              let: { branchId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$branchId", "$$branchId"] },
                        { $eq: ["$admissionStatus", AdmissionStatus.ADMITTED] },
                      ],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    personId: "$_id",
                    personKind: { $literal: EvacPersonKind.RESIDENT },
                    roomNumber: 1,
                  },
                },
              ],
              as: "rows",
            },
          },
          { $unwind: "$rows" },
          { $replaceRoot: { newRoot: "$rows" } },
        ],
        visits: [
          {
            $lookup: {
              from: COLLECTIONS.visitSessions,
              let: { branchId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$branchId", "$$branchId"] },
                        { $eq: ["$status", VisitSessionStatus.ON_SITE] },
                        { $eq: ["$checkOutAt", null] },
                        { $ne: ["$externalPersonId", null] },
                      ],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    personId: "$externalPersonId",
                    personKind: {
                      $cond: [
                        { $eq: ["$personType", ExternalPersonType.CONTRACTOR] },
                        EvacPersonKind.CONTRACTOR,
                        EvacPersonKind.VISITOR,
                      ],
                    },
                  },
                },
              ],
              as: "rows",
            },
          },
          { $unwind: "$rows" },
          { $replaceRoot: { newRoot: "$rows" } },
        ],
      },
    },
  ]);

  const docs = [
    ...(seed?.staff || []).map((row) => ({
      evacuationEventId: eventId,
      personKind: row.personKind,
      personId: row.personId,
      status: EvacCheckStatus.UNKNOWN,
      markedAt,
    })),
    ...(seed?.residents || []).map((row) => ({
      evacuationEventId: eventId,
      personKind: row.personKind,
      personId: row.personId,
      status: EvacCheckStatus.UNKNOWN,
      markedAt,
      lastSeenLabel: row.roomNumber ? `Room ${row.roomNumber}` : "",
      lastSeenAt: markedAt,
    })),
    ...(seed?.visits || []).map((row) => ({
      evacuationEventId: eventId,
      personKind: row.personKind,
      personId: row.personId,
      status: EvacCheckStatus.UNKNOWN,
      markedAt,
    })),
  ];

  if (!docs.length) return;

  try {
    await EvacCheck.insertMany(docs, { ordered: false });
  } catch (error) {
    if (error?.code !== 11000 && !error?.writeErrors) throw error;
  }
};

/** Polymorphic person enrichment in one pipeline (staff → user, resident, external). */
const checkPersonLookupStages = [
  {
    $lookup: {
      from: COLLECTIONS.staffProfiles,
      let: { personId: "$personId", kind: "$personKind" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$$kind", EvacPersonKind.STAFF] },
                { $eq: ["$_id", "$$personId"] },
              ],
            },
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.users,
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            name: { $ifNull: ["$user.name", ""] },
            email: { $ifNull: ["$user.email", ""] },
            employeeCode: { $ifNull: ["$employeeCode", ""] },
          },
        },
      ],
      as: "staffPerson",
    },
  },
  {
    $lookup: {
      from: COLLECTIONS.residents,
      let: { personId: "$personId", kind: "$personKind" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$$kind", EvacPersonKind.RESIDENT] },
                { $eq: ["$_id", "$$personId"] },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            name: { $ifNull: ["$name", ""] },
            roomNumber: { $ifNull: ["$roomNumber", ""] },
          },
        },
      ],
      as: "residentPerson",
    },
  },
  {
    $lookup: {
      from: COLLECTIONS.externalPeople,
      let: { personId: "$personId", kind: "$personKind" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                {
                  $in: [
                    "$$kind",
                    [EvacPersonKind.VISITOR, EvacPersonKind.CONTRACTOR],
                  ],
                },
                { $eq: ["$_id", "$$personId"] },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            name: { $ifNull: ["$name", ""] },
            email: { $ifNull: ["$email", ""] },
          },
        },
      ],
      as: "externalPerson",
    },
  },
  {
    $addFields: {
      person: {
        $switch: {
          branches: [
            {
              case: { $eq: ["$personKind", EvacPersonKind.STAFF] },
              then: { $arrayElemAt: ["$staffPerson", 0] },
            },
            {
              case: { $eq: ["$personKind", EvacPersonKind.RESIDENT] },
              then: { $arrayElemAt: ["$residentPerson", 0] },
            },
          ],
          default: { $arrayElemAt: ["$externalPerson", 0] },
        },
      },
    },
  },
  {
    $project: {
      staffPerson: 0,
      residentPerson: 0,
      externalPerson: 0,
    },
  },
];

/** One scan of this event's checks: counts for the header, cards for the list. */
const rollcallDetailLookup = (eventIdExpr = "$_id") => [
  {
    $lookup: {
      from: COLLECTIONS.evacChecks,
      let: { eventId: eventIdExpr },
      pipeline: [
        { $match: { $expr: { $eq: ["$evacuationEventId", "$$eventId"] } } },
        {
          $facet: {
            stats: [
              {
                $group: {
                  _id: { kind: "$personKind", status: "$status" },
                  count: { $sum: 1 },
                },
              },
            ],
            checks: [
              { $sort: { status: 1, updatedAt: -1 } },
              ...checkPersonLookupStages,
            ],
          },
        },
      ],
      as: "rollcall",
    },
  },
  {
    $set: {
      rollcall: {
        $ifNull: [
          { $arrayElemAt: ["$rollcall", 0] },
          { stats: [], checks: [] },
        ],
      },
    },
  },
];

const loadEventWithBranchAndStats = async ({
  match,
  organizationId,
  includeStats = true,
  includeChecks = false,
  includeFamilyAlert = false,
}) => {
  const pipeline = [{ $match: match }, { $limit: 1 }, ...branchLookupPipeline];

  if (organizationId) {
    pipeline.push({
      $match: {
        "branchDoc.organizationId": toObjectId(organizationId),
      },
    });
  }

  if (includeChecks) {
    pipeline.push(...rollcallDetailLookup("$_id"));
  } else if (includeStats) {
    pipeline.push(...rollcallStatsPipeline("$_id"));
  }

  const [doc] = await EvacuationEvent.aggregate(pipeline);
  if (!doc || !doc.branchDoc) return null;
  return formatEventDoc(doc, { includeFamilyAlert });
};

const startEvacuation = async ({
  organizationId,
  branchId,
  type,
  startedByUserId = null,
  kioskId = null,
  actor = null,
}) => {
  const branchOid = toObjectId(branchId);
  const evacuationType = parseEvacuationType(type);

  if (actor && organizationId) {
    const standing = await actorStanding(actor, organizationId);
    assertMayManageStaff(standing, branchOid);
  }

  const branchMatch = { _id: branchOid };
  if (organizationId) branchMatch.organizationId = toObjectId(organizationId);

  const branch = await Branch.findOne(branchMatch).select("_id").lean();
  if (!branch) throw new AppError("branch_not_found", 404);

  const existing = await EvacuationEvent.exists({
    branchId: branchOid,
    status: EvacuationStatus.ACTIVE,
  });
  if (existing) throw new AppError("evacuation_already_active", 409);

  const startedAt = new Date();
  const event = await EvacuationEvent.create({
    branchId: branchOid,
    type: evacuationType,
    startedAt,
    startedByUserId: startedByUserId || null,
    kioskId: kioskId || null,
    status: EvacuationStatus.ACTIVE,
  });

  await seedRollcallChecks(event);

  return loadEventWithBranchAndStats({
    match: { _id: event._id },
    organizationId,
    includeStats: true,
  });
};

const getActiveEvacuation = async ({
  organizationId,
  branchId,
  includeStats = true,
}) => {
  const branchOid = toObjectId(branchId);
  if (organizationId) {
    await assertBranchInOrganization(branchOid, organizationId);
  }

  return loadEventWithBranchAndStats({
    match: { branchId: branchOid, status: EvacuationStatus.ACTIVE },
    organizationId: null,
    includeStats,
  });
};

const getEvacuationEvent = async ({
  organizationId,
  evacuationEventId,
  actor,
}) => {
  const eventOid = toObjectId(evacuationEventId);

  const data = await loadEventWithBranchAndStats({
    match: { _id: eventOid },
    organizationId,
    includeChecks: true,
  });

  if (!data) throw new AppError("evacuation_event_not_found", 404);

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    assertSiteManagerBranch(standing, data.branchId);
  }

  return data;
};

const emptyEvacuationStatusCounts = () => ({
  all: 0,
  [EvacuationStatus.ACTIVE]: 0,
  [EvacuationStatus.CLOSED]: 0,
});

/** Same branch/type scope as the list; status is grouped, not filtered. */
const countEvacuationsByStatus = async (match) => {
  const [row] = await EvacuationEvent.aggregate([
    { $match: match },
    {
      $facet: {
        allCount: [{ $count: "count" }],
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
      },
    },
  ]);

  const counts = emptyEvacuationStatusCounts();
  counts.all = facetCount(row?.allCount);
  for (const statusRow of row?.byStatus || []) {
    if (counts[statusRow._id] !== undefined) counts[statusRow._id] = statusRow.count;
  }
  return counts;
};

const listEvacuations = async ({
  organizationId,
  actor,
  page,
  limit,
  skip,
  branchId,
  status,
  type,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId || null);
  const orgOid = toObjectId(organizationId);

  let branchIds;
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchIds = [toObjectId(scopedBranchId)];
  } else {
    const orgBranches = await Branch.find({ organizationId: orgOid })
      .select("_id")
      .lean();
    branchIds = orgBranches.map((b) => b._id);
    if (!branchIds.length) {
      return {
        data: [],
        meta: {
          currentPage: page,
          totalPages: 0,
          totalRecords: 0,
          limit,
          counts: emptyEvacuationStatusCounts(),
        },
      };
    }
  }

  const match = { branchId: { $in: branchIds } };
  if (type) match.type = parseEvacuationType(type);

  const listMatch = status ? { ...match, status } : match;

  const [{ data, meta }, counts] = await Promise.all([
    paginateWithFacet({
      model: EvacuationEvent,
      match: listMatch,
      page,
      limit,
      skip,
      sort: { startedAt: -1 },
      extraDataStages: [
        ...branchLookupPipeline,
        {
          $lookup: {
            from: COLLECTIONS.evacChecks,
            localField: "_id",
            foreignField: "evacuationEventId",
            pipeline: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  safe: {
                    $sum: {
                      $cond: [{ $eq: ["$status", EvacCheckStatus.SAFE] }, 1, 0],
                    },
                  },
                },
              },
            ],
            as: "rollcallAgg",
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.users,
            localField: "startedByUserId",
            foreignField: "_id",
            pipeline: [
              {
                $project: {
                  _id: 1,
                  name: 1,
                  email: 1,
                  image: { $ifNull: ["$profileIcon", ""] },
                },
              },
              { $limit: 1 },
            ],
            as: "startedBy",
          },
        },
        {
          $project: {
            type: 1,
            status: 1,
            startedAt: 1,
            closedAt: 1,
            startedByUserId: 1,
            startedBy: { $ifNull: [{ $arrayElemAt: ["$startedBy", 0] }, null] },
            kioskId: 1,
            branchId: 1,
            createdAt: 1,
            updatedAt: 1,
            branch: {
              _id: "$branchDoc._id",
              name: "$branchDoc.name",
              assemblyPoint: { $ifNull: ["$branchDoc.assemblyPoint", ""] },
            },
            rollcall: {
              safe: {
                $ifNull: [{ $arrayElemAt: ["$rollcallAgg.safe", 0] }, 0],
              },
              total: {
                $ifNull: [{ $arrayElemAt: ["$rollcallAgg.total", 0] }, 0],
              },
            },
          },
        },
      ],
    }),
    countEvacuationsByStatus(match),
  ]);

  return { data, meta: { ...meta, counts } };
};

const closeEvacuation = async ({
  organizationId,
  evacuationEventId,
  actor = null,
  kioskId = null,
}) => {
  const eventOid = toObjectId(evacuationEventId);
  const orgOid = organizationId ? toObjectId(organizationId) : null;

  const [eventRow] = await EvacuationEvent.aggregate([
    { $match: { _id: eventOid } },
    ...branchLookupPipeline,
    ...(orgOid ? [{ $match: { "branchDoc.organizationId": orgOid } }] : []),
    {
      $project: {
        branchId: 1,
        status: 1,
        kioskId: 1,
      },
    },
  ]);
  if (!eventRow) throw new AppError("evacuation_event_not_found", 404);

  if (kioskId) {
    if (!eventRow.kioskId || String(eventRow.kioskId) !== String(kioskId)) {
      throw new AppError("insufficient_role", 403);
    }
  } else if (actor) {
    const standing = await actorStanding(actor, organizationId);
    assertMayManageStaff(standing, eventRow.branchId);
  } else {
    throw new AppError("insufficient_role", 403);
  }

  if (eventRow.status === EvacuationStatus.CLOSED) {
    throw new AppError("evacuation_already_closed", 409);
  }

  await EvacuationEvent.updateOne(
    { _id: eventOid },
    { $set: { status: EvacuationStatus.CLOSED, closedAt: new Date() } },
  );

  return loadEventWithBranchAndStats({
    match: { _id: eventOid },
    organizationId,
    includeStats: false,
  });
};

const FAMILY_UPDATE_TEXT = {
  [FamilyUpdatePreset.ALL_RESIDENTS_AT_ASSEMBLY_POINT]:
    "All residents are at the assembly point.",
  [FamilyUpdatePreset.FIRE_SERVICE_ON_SITE]: "The fire service is on site.",
  [FamilyUpdatePreset.RESIDENTS_BACK_INSIDE]: "Residents are back inside.",
};

const loadFamilyEvent = async ({ organizationId, evacuationEventId, actor }) => {
  const [event] = await EvacuationEvent.aggregate([
    { $match: { _id: toObjectId(evacuationEventId) } },
    ...branchLookupPipeline,
    { $match: { "branchDoc.organizationId": toObjectId(organizationId) } },
    {
      $project: {
        branchId: 1,
        type: 1,
        status: 1,
        familyAlert: 1,
        branchName: "$branchDoc.name",
        organizationId: "$branchDoc.organizationId",
      },
    },
  ]);
  if (!event) throw new AppError("evacuation_event_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, event.branchId);

  const [organization] = await Organization.aggregate([
    { $match: { _id: event.organizationId } },
    {
      $project: {
        offsite: { $ifNull: ["$settings.emergencyNotifyOffsite", false] },
      },
    },
  ]);
  return {
    ...event,
    offsite: Boolean(organization?.offsite),
    familyAlert: familyAlertOf(event.familyAlert),
  };
};

const loadEventForFamilyMessage = async (args) => {
  const event = await loadFamilyEvent(args);
  if (event.type !== EvacuationType.REAL) {
    throw new AppError("family_alert_not_for_drills", 400);
  }
  if (!event.offsite) throw new AppError("offsite_alerts_disabled", 403);
  return event;
};

const getFamilyAlert = async ({ organizationId, evacuationEventId, actor }) => {
  const event = await loadFamilyEvent({
    organizationId,
    evacuationEventId,
    actor,
  });
  return {
    evacuationEventId: event._id,
    type: event.type,
    status: event.status,
    offsiteAlertsEnabled: event.offsite,
    familiesToNotify: await countFamilies(event.branchId),
    familyAlert: event.familyAlert,
  };
};

const loadScopedEvent = async ({
  organizationId,
  evacuationEventId,
  actor,
  includeStats,
}) => {
  const event = await loadEventWithBranchAndStats({
    match: { _id: toObjectId(evacuationEventId) },
    organizationId,
    includeStats,
  });
  if (!event) throw new AppError("evacuation_event_not_found", 404);
  const standing = await actorStanding(actor, organizationId);
  assertSiteManagerBranch(standing, event.branchId);
  return event;
};

const listUnaccounted = async ({
  organizationId,
  evacuationEventId,
  actor,
  status,
  personKind,
  page,
  limit,
  skip,
}) => {
  const event = await loadScopedEvent({
    organizationId,
    evacuationEventId,
    actor,
    includeStats: false,
  });

  const match = { evacuationEventId: toObjectId(evacuationEventId) };
  if (status) match.status = parseCheckStatus(status);
  else {
    match.status = { $in: [EvacCheckStatus.UNKNOWN, EvacCheckStatus.MISSING] };
  }
  if (personKind) match.personKind = parsePersonKind(personKind);

  const { data, meta } = await paginateWithFacet({
    model: EvacCheck,
    match,
    page,
    limit,
    skip,
    sort: { status: 1, updatedAt: -1 },
    extraDataStages: [
      ...checkPersonLookupStages,
      {
        $lookup: {
          from: COLLECTIONS.staffProfiles,
          localField: "personId",
          foreignField: "_id",
          as: "_staff",
          pipeline: [{ $project: { jobTitleId: 1 } }],
        },
      },
      {
        $lookup: {
          from: JobTitle.collection.name,
          localField: "_staff.jobTitleId",
          foreignField: "_id",
          as: "_jobTitle",
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      {
        $lookup: {
          from: COLLECTIONS.visitSessions,
          let: { personId: "$personId" },
          as: "_visit",
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$externalPersonId", "$$personId"] },
                    { $eq: ["$branchId", event.branchId] },
                  ],
                },
              },
            },
            { $sort: { checkInAt: -1 } },
            { $limit: 1 },
            { $project: { checkInAt: 1, purposeOfVisit: 1 } },
          ],
        },
      },
      {
        $project: {
          _id: 1,
          personKind: 1,
          personId: 1,
          status: 1,
          markedAt: 1,
          locationLabel: 1,
          lastSeenLabel: 1,
          lastSeenAt: 1,
          name: { $ifNull: ["$person.name", ""] },
          email: { $ifNull: ["$person.email", ""] },
          employeeCode: { $ifNull: ["$person.employeeCode", ""] },
          roomNumber: { $ifNull: ["$person.roomNumber", ""] },
          jobTitle: { $ifNull: [{ $arrayElemAt: ["$_jobTitle.name", 0] }, ""] },
          signedInAt: { $ifNull: [{ $arrayElemAt: ["$_visit.checkInAt", 0] }, null] },
          visitPurpose: {
            $ifNull: [{ $arrayElemAt: ["$_visit.purposeOfVisit", 0] }, ""],
          },
        },
      },
    ],
  });

  return { data, meta };
};

const getRollcall = async ({
  organizationId,
  evacuationEventId,
  actor,
  status,
  personKind,
  page,
  limit,
  skip,
}) => {
  const [event, familyState, unaccounted] = await Promise.all([
    loadScopedEvent({
      organizationId,
      evacuationEventId,
      actor,
      includeStats: true,
    }),
    getFamilyAlert({ organizationId, evacuationEventId, actor }),
    listUnaccounted({
      organizationId,
      evacuationEventId,
      actor,
      status,
      personKind,
      page,
      limit,
      skip,
    }),
  ]);

  return {
    data: {
      ...event,
      familyAlert: {
        offsiteAlertsEnabled: familyState.offsiteAlertsEnabled,
        familiesToNotify: familyState.familiesToNotify,
        ...familyState.familyAlert,
      },
      unaccounted: unaccounted.data,
    },
    meta: unaccounted.meta,
  };
};

const claimFamilyAlert = async ({ event, from, set, requireActive }) => {
  const filter = { _id: event._id, "familyAlert.status": { $in: from } };
  if (requireActive) filter.status = EvacuationStatus.ACTIVE;
  const claimed = await EvacuationEvent.updateOne(filter, { $set: set });
  return claimed.modifiedCount === 1;
};

const respondWithEvent = (event, organizationId) =>
  loadEventWithBranchAndStats({
    match: { _id: event._id },
    organizationId,
    includeStats: true,
    includeFamilyAlert: true,
  });

const alertFamilies = async ({ organizationId, evacuationEventId, actor }) => {
  const event = await loadEventForFamilyMessage({
    organizationId,
    evacuationEventId,
    actor,
  });
  if (event.status !== EvacuationStatus.ACTIVE) {
    throw new AppError("evacuation_not_active", 409);
  }
  const now = new Date();
  const claimed = await claimFamilyAlert({
    event,
    from: [FamilyAlertStatus.NOT_SENT],
    requireActive: true,
    set: {
      "familyAlert.status": FamilyAlertStatus.ALERT_SENT,
      "familyAlert.alertedAt": now,
      "familyAlert.alertedByUserId": actor._id,
    },
  });
  if (!claimed) throw new AppError("family_alert_already_sent", 409);

  try {
    const familiesNotified = await sendFamilyMessage({
      event,
      actor,
      title: "Emergency at the home",
      body: `${event.branchName} has started an evacuation. Please do not travel to the home or phone it. We will send updates.`,
    });
    await EvacuationEvent.updateOne(
      { _id: event._id },
      { $set: { "familyAlert.familiesNotified": familiesNotified } },
    );
  } catch (error) {
    await EvacuationEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          "familyAlert.status": FamilyAlertStatus.NOT_SENT,
          "familyAlert.alertedAt": null,
          "familyAlert.alertedByUserId": null,
        },
      },
    );
    throw error;
  }
  return respondWithEvent(event, organizationId);
};

const parseFamilyUpdatePresets = (presets) => {
  if (!Array.isArray(presets) || !presets.length) {
    throw new AppError("family_update_required", 400);
  }
  const unique = [...new Set(presets.map((value) => String(value).trim()))];
  if (unique.some((value) => !FAMILY_UPDATE_TEXT[value])) {
    throw new AppError("invalid_family_update_preset", 400);
  }
  return unique;
};

const updateFamilies = async ({
  organizationId,
  evacuationEventId,
  actor,
  presets,
}) => {
  const chosen = parseFamilyUpdatePresets(presets);
  const event = await loadEventForFamilyMessage({
    organizationId,
    evacuationEventId,
    actor,
  });
  if (event.status !== EvacuationStatus.ACTIVE) {
    throw new AppError("evacuation_not_active", 409);
  }
  if (event.familyAlert.status === FamilyAlertStatus.NOT_SENT) {
    throw new AppError("family_alert_not_sent", 409);
  }
  if (event.familyAlert.status === FamilyAlertStatus.ALL_CLEAR_SENT) {
    throw new AppError("family_all_clear_already_sent", 409);
  }

  const message = chosen.map((value) => FAMILY_UPDATE_TEXT[value]).join(" ");
  const familiesNotified = await sendFamilyMessage({
    event,
    actor,
    title: "Update from the home",
    body: message,
  });
  await EvacuationEvent.updateOne(
    { _id: event._id },
    {
      $push: {
        "familyAlert.updates": {
          presets: chosen,
          message,
          sentAt: new Date(),
          sentByUserId: actor._id,
          familiesNotified,
        },
      },
    },
  );
  return respondWithEvent(event, organizationId);
};

const allClearFamilies = async ({
  organizationId,
  evacuationEventId,
  actor,
}) => {
  const event = await loadEventForFamilyMessage({
    organizationId,
    evacuationEventId,
    actor,
  });
  if (event.familyAlert.status === FamilyAlertStatus.NOT_SENT) {
    throw new AppError("family_alert_not_sent", 409);
  }
  const claimed = await claimFamilyAlert({
    event,
    from: [FamilyAlertStatus.ALERT_SENT],
    requireActive: false,
    set: {
      "familyAlert.status": FamilyAlertStatus.ALL_CLEAR_SENT,
      "familyAlert.allClearAt": new Date(),
      "familyAlert.allClearByUserId": actor._id,
    },
  });
  if (!claimed) throw new AppError("family_all_clear_already_sent", 409);

  try {
    await sendFamilyMessage({
      event,
      actor,
      title: "All clear at the home",
      body: `The emergency at ${event.branchName} is over.`,
    });
  } catch (error) {
    await EvacuationEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          "familyAlert.status": FamilyAlertStatus.ALERT_SENT,
          "familyAlert.allClearAt": null,
          "familyAlert.allClearByUserId": null,
        },
      },
    );
    throw error;
  }
  return respondWithEvent(event, organizationId);
};

/** Close the active event for a branch in one flow (kiosk all-clear). */
const closeActiveEvacuationForBranch = async ({
  organizationId,
  branchId,
  kioskId,
}) => {
  const branchOid = toObjectId(branchId);
  if (organizationId) {
    await assertBranchInOrganization(branchOid, organizationId);
  }

  const event = await EvacuationEvent.findOne({
    branchId: branchOid,
    status: EvacuationStatus.ACTIVE,
  });
  if (!event) throw new AppError("no_active_evacuation", 404);

  if (kioskId) {
    if (!event.kioskId || String(event.kioskId) !== String(kioskId)) {
      throw new AppError("insufficient_role", 403);
    }
  } else {
    throw new AppError("insufficient_role", 403);
  }

  event.status = EvacuationStatus.CLOSED;
  event.closedAt = new Date();
  await event.save();

  return loadEventWithBranchAndStats({
    match: { _id: event._id },
    organizationId,
    includeStats: false,
  });
};

const enrichSingleCheck = async (checkId) => {
  const [row] = await EvacCheck.aggregate([
    { $match: { _id: checkId } },
    ...checkPersonLookupStages,
  ]);
  return row || null;
};

const upsertEvacCheck = async ({
  organizationId,
  evacuationEventId,
  personKind,
  personId,
  status,
  markedAt,
  locationLabel,
  geo,
  lastSeenLabel,
  lastSeenAt,
  clientEventId,
  actor = null,
  allowSelfOnly = false,
  staffProfile = null,
}) => {
  const eventOid = toObjectId(evacuationEventId);
  const personOid = toObjectId(personId);
  const kind = parsePersonKind(personKind);
  const checkStatus = parseCheckStatus(status || EvacCheckStatus.SAFE);
  const orgOid = toObjectId(organizationId);

  const [event] = await EvacuationEvent.aggregate([
    { $match: { _id: eventOid } },
    ...branchLookupPipeline,
    { $match: { "branchDoc.organizationId": orgOid } },
    { $project: { branchId: 1, status: 1 } },
  ]);
  if (!event) throw new AppError("evacuation_event_not_found", 404);
  if (event.status !== EvacuationStatus.ACTIVE) {
    throw new AppError("evacuation_not_active", 409);
  }

  if (allowSelfOnly) {
    const profile =
      staffProfile ||
      (await StaffProfile.findOne({
        userId: actor._id,
        organizationId,
        status: StaffProfileStatus.ACTIVE,
      })
        .select("_id branchId")
        .lean());

    if (!profile) throw new AppError("staff_profile_not_found", 403);
    if (
      kind !== EvacPersonKind.STAFF ||
      String(personOid) !== String(profile._id)
    ) {
      throw new AppError("evac_check_self_only", 403);
    }
    if (String(profile.branchId) !== String(event.branchId)) {
      throw new AppError("outside_managed_branch", 403);
    }
  } else if (actor) {
    const standing = await actorStanding(actor, organizationId);
    if (!MANAGER_ROLES.includes(standing.role)) {
      throw new AppError("insufficient_role", 403);
    }
    assertMayManageStaff(standing, event.branchId);
  }

  if (clientEventId) {
    const existingByClient = await EvacCheck.findOne({ clientEventId })
      .select("_id")
      .lean();
    if (existingByClient) {
      return enrichSingleCheck(existingByClient._id);
    }
  }

  const payload = {
    status: checkStatus,
    markedAt: markedAt ? new Date(markedAt) : new Date(),
    locationLabel: locationLabel || "",
    geo: {
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      accuracy: geo?.accuracy ?? null,
    },
  };

  if (lastSeenLabel !== undefined) payload.lastSeenLabel = lastSeenLabel || "";
  if (lastSeenAt !== undefined) {
    payload.lastSeenAt = lastSeenAt ? new Date(lastSeenAt) : null;
  }
  if (clientEventId) payload.clientEventId = clientEventId;

  const check = await EvacCheck.findOneAndUpdate(
    {
      evacuationEventId: eventOid,
      personKind: kind,
      personId: personOid,
    },
    {
      $set: payload,
      $setOnInsert: {
        evacuationEventId: eventOid,
        personKind: kind,
        personId: personOid,
      },
    },
    { new: true, upsert: true, runValidators: true },
  ).lean();

  return enrichSingleCheck(check._id);
};

const listEvacChecks = async ({
  organizationId,
  evacuationEventId,
  actor,
  status,
  personKind,
  unaccountedOnly = false,
}) => {
  const eventOid = toObjectId(evacuationEventId);

  const event = await loadEventWithBranchAndStats({
    match: { _id: eventOid },
    organizationId,
    includeStats: true,
  });
  if (!event) throw new AppError("evacuation_event_not_found", 404);

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    assertSiteManagerBranch(standing, event.branchId);
  }

  const match = { evacuationEventId: eventOid };
  if (unaccountedOnly) {
    match.status = { $in: [EvacCheckStatus.UNKNOWN, EvacCheckStatus.MISSING] };
  } else if (status) {
    match.status = parseCheckStatus(status);
  }
  if (personKind) match.personKind = parsePersonKind(personKind);

  const data = await EvacCheck.aggregate([
    { $match: match },
    { $sort: { status: 1, updatedAt: -1 } },
    ...checkPersonLookupStages,
  ]);

  return {
    event,
    rollcallStats: event.rollcallStats,
    data,
  };
};

const markSelfCheck = async ({
  organizationId,
  userId,
  status,
  locationLabel,
  geo,
  clientEventId,
  branchId,
}) => {
  const profile = await StaffProfile.findOne({
    userId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id branchId")
    .lean();

  if (!profile) throw new AppError("staff_profile_not_found", 403);

  const targetBranchId = branchId || profile.branchId;
  toObjectId(targetBranchId);

  if (String(profile.branchId) !== String(targetBranchId)) {
    throw new AppError("outside_managed_branch", 403);
  }

  const active = await EvacuationEvent.findOne({
    branchId: targetBranchId,
    status: EvacuationStatus.ACTIVE,
  })
    .select("_id")
    .lean();

  if (!active) throw new AppError("no_active_evacuation", 404);

  return upsertEvacCheck({
    organizationId,
    evacuationEventId: active._id,
    personKind: EvacPersonKind.STAFF,
    personId: profile._id,
    status: status || EvacCheckStatus.SAFE,
    locationLabel,
    geo,
    clientEventId,
    actor: { _id: userId },
    allowSelfOnly: true,
    staffProfile: profile,
  });
};

const drillScoreMeta = (expected, done) => ({
  percent:
    expected === 0 ? null : Math.min(100, Math.round((done / expected) * 100)),
  done,
  expected,
  windowMonths: DRILL_WINDOW_MONTHS,
});

/** Mock drills this staff marked on, last 12 months, one aggregation. */
const myDrills = async ({ actor, organizationId, page, limit, skip }) => {
  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const profile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId: orgOid,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id branchId")
    .lean();
  if (!profile) throw new AppError("staff_profile_not_found", 404);

  const empty = {
    data: [],
    meta: {
      ...generateMeta(page, limit, 0),
      fireDrills: drillScoreMeta(0, 0),
    },
  };
  if (!profile.branchId) return empty;

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - DRILL_WINDOW_MONTHS);

  const [result] = await EvacuationEvent.aggregate([
    {
      $match: {
        branchId: profile.branchId,
        type: EvacuationType.MOCK,
        startedAt: { $gte: since },
      },
    },
    {
      $lookup: {
        from: COLLECTIONS.evacChecks,
        let: { eventId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$evacuationEventId", "$$eventId"] },
              personKind: EvacPersonKind.STAFF,
              personId: profile._id,
            },
          },
          {
            $project: { status: 1, locationLabel: 1, markedAt: 1 },
          },
          { $limit: 1 },
        ],
        as: "check",
      },
    },
    { $unwind: "$check" },
    { $sort: { startedAt: -1 } },
    {
      $facet: {
        score: [
          {
            $group: {
              _id: null,
              expected: { $sum: 1 },
              done: {
                $sum: {
                  $cond: [
                    { $eq: ["$check.status", EvacCheckStatus.SAFE] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        total: [
          { $match: { "check.status": EvacCheckStatus.SAFE } },
          { $count: "count" },
        ],
        rows: [
          { $match: { "check.status": EvacCheckStatus.SAFE } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: COLLECTIONS.branches,
              localField: "branchId",
              foreignField: "_id",
              pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
              as: "branch",
            },
          },
          {
            $project: {
              _id: 0,
              evacuationEventId: "$_id",
              startedAt: 1,
              closedAt: 1,
              durationSeconds: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$closedAt", null] },
                      { $ne: ["$startedAt", null] },
                    ],
                  },
                  {
                    $max: [
                      0,
                      {
                        $round: [
                          {
                            $divide: [
                              { $subtract: ["$closedAt", "$startedAt"] },
                              1000,
                            ],
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  null,
                ],
              },
              type: 1,
              status: 1,
              attended: { $literal: true },
              checkStatus: "$check.status",
              locationLabel: "$check.locationLabel",
              markedAt: "$check.markedAt",
              branch: { $arrayElemAt: ["$branch", 0] },
            },
          },
        ],
      },
    },
  ]);

  const score = result?.score?.[0];
  const total = result?.total?.[0]?.count ?? 0;

  return {
    data: result?.rows || [],
    meta: {
      ...generateMeta(page, limit, total),
      fireDrills: drillScoreMeta(score?.expected ?? 0, score?.done ?? 0),
    },
  };
};

module.exports = {
  getOnSiteSummary,
  startEvacuation,
  getActiveEvacuation,
  getEvacuationEvent,
  listEvacuations,
  closeEvacuation,
  closeActiveEvacuationForBranch,
  getRollcall,
  alertFamilies,
  updateFamilies,
  allClearFamilies,
  upsertEvacCheck,
  listEvacChecks,
  markSelfCheck,
  myDrills,
};
