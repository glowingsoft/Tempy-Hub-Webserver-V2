const mongoose = require("mongoose");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { EvacCheck } = require("@models/EvacCheck");
const { Branch } = require("@models/Branch");
const { AttendanceDay } = require("@models/AttendanceDay");
const { StaffProfile } = require("@models/StaffProfile");
const { Resident } = require("@models/Resident");
const { VisitSession } = require("@models/VisitSession");
const { ExternalPerson } = require("@models/ExternalPerson");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  EvacuationType,
  EvacuationStatus,
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
const { notifyFamilies } = require("./evacuationNotify");

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
};

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

const formatEventDoc = (doc) => {
  if (!doc) return null;
  const { branchDoc, statRows, rollcall, ...event } = doc;
  const formatted = {
    ...event,
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
  const standing = actor
    ? await actorStanding(actor, organizationId)
    : null;
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
}) => {
  const pipeline = [
    { $match: match },
    { $limit: 1 },
    ...branchLookupPipeline,
  ];

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
  return formatEventDoc(doc);
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
  if (evacuationType === EvacuationType.REAL) notifyFamilies({ event });

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
  [EvacuationStatus.ACTIVE]: 0,
  [EvacuationStatus.CLOSED]: 0,
});

/** Same branch/type scope as the list; status is grouped, not filtered. */
const countEvacuationsByStatus = async (match) => {
  const rows = await EvacuationEvent.aggregate([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const counts = emptyEvacuationStatusCounts();
  for (const row of rows) {
    if (counts[row._id] !== undefined) counts[row._id] = row.count;
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
                    $cond: [
                      { $eq: ["$status", EvacCheckStatus.SAFE] },
                      1,
                      0,
                    ],
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
    ...(orgOid
      ? [{ $match: { "branchDoc.organizationId": orgOid } }]
      : []),
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
    { $set: { status: EvacuationStatus.CLOSED, closedAt: new Date() } }
  );

  return loadEventWithBranchAndStats({
    match: { _id: eventOid },
    organizationId,
    includeStats: false,
  });
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
    if (kind !== EvacPersonKind.STAFF || String(personOid) !== String(profile._id)) {
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
    { new: true, upsert: true, runValidators: true }
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

module.exports = {
  getOnSiteSummary,
  startEvacuation,
  getActiveEvacuation,
  getEvacuationEvent,
  listEvacuations,
  closeEvacuation,
  closeActiveEvacuationForBranch,
  upsertEvacCheck,
  listEvacChecks,
  markSelfCheck,
};
