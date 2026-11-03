const { VisitSession } = require("@models/VisitSession");
const { ExternalPerson } = require("@models/ExternalPerson");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const moment = require("moment-timezone");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { AppError } = require("@services/_errors/AppError");
const {
  VisitMethod,
  VisitSessionStatus,
  ExternalPersonType,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./visitorAccess");
const {
  aggregateVisitPresence,
  countVisitPresenceByType,
  toObjectId,
  parsePersonTypes,
  parseStatuses,
  parseDateRange,
} = require("./visitPresenceQuery");

const VISIT_SESSION_STATUSES = Object.values(VisitSessionStatus);

const emptyVisitSessionStatusCounts = () =>
  Object.fromEntries(VISIT_SESSION_STATUSES.map((status) => [status, 0]));

const visitSessionStatusCountFacets = (countMatch) => ({
  statusCounts: [
    { $match: countMatch },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ],
});

const visitSessionStatusCountsFromFacet = (result) => {
  const counts = emptyVisitSessionStatusCounts();
  for (const row of result.statusCounts || []) {
    if (Object.prototype.hasOwnProperty.call(counts, row._id)) {
      counts[row._id] = row.count;
    }
  }
  return counts;
};

const emptyVisitSessionList = (page, limit) => ({
  data: [],
  meta: {
    page,
    limit,
    total: 0,
    totalPages: 0,
    counts: emptyVisitSessionStatusCounts(),
  },
});

const visitDetailStages = [
  {
    $lookup: {
      from: ExternalPerson.collection.name,
      localField: "externalPersonId",
      foreignField: "_id",
      pipeline: [
        {
          $project: {
            name: 1,
            email: 1,
            phone: 1,
            type: 1,
            photoUrl: 1,
            categoryId: 1,
            departmentId: 1,
            carRegistration: 1,
          },
        },
        { $limit: 1 },
      ],
      as: "_person",
    },
  },
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      pipeline: [
        {
          $project: {
            name: 1,
            code: 1,
            timezone: 1,
            status: 1,
            address: 1,
          },
        },
        { $limit: 1 },
      ],
      as: "_branch",
    },
  },
  {
    $addFields: {
      person: { $arrayElemAt: ["$_person", 0] },
      branch: { $arrayElemAt: ["$_branch", 0] },
    },
  },
  { $project: { _person: 0, _branch: 0 } },
];

const shapeVisitRow = (row) => {
  if (!row) return row;
  const person = row.person || null;
  return {
    ...row,
    person: person
      ? {
          ...person,
          photoUrl: toPublicImageUrl(person.photoUrl),
        }
      : null,
    branch: row.branch || null,
  };
};

const parseMethod = (method) => {
  const value = method || VisitMethod.WALK_IN;
  if (!Object.values(VisitMethod).includes(value)) {
    throw new AppError("invalid_visit_method", 400);
  }
  return value;
};

const assertNoOpenVisit = async ({ branchId, externalPersonId }) => {
  const open = await VisitSession.exists({
    branchId,
    externalPersonId,
    status: {
      $in: [VisitSessionStatus.ON_SITE, VisitSessionStatus.AWAITING_APPROVAL],
    },
    checkOutAt: null,
  });
  if (open) throw new AppError("visit_already_on_site", 409);
};

const createVisitSession = async ({
  organizationId,
  branchId,
  externalPersonId,
  personType,
  method,
  purposeOfVisit,
  hostStaffId,
  hostName,
  kioskId,
  invitationId,
  status = VisitSessionStatus.ON_SITE,
  policiesSigned,
}) => {
  if (!branchId) throw new AppError("branch_required", 400);
  if (!externalPersonId) throw new AppError("external_person_id_required", 400);

  const person = await ExternalPerson.findOne({
    _id: externalPersonId,
    branchId,
  }).lean();
  if (!person) throw new AppError("external_person_not_found", 404);

  await assertNoOpenVisit({ branchId, externalPersonId });

  if (hostStaffId) {
    const host = await StaffProfile.exists({
      _id: hostStaffId,
      organizationId,
      branchId,
    });
    if (!host) throw new AppError("staff_not_in_branch", 404);
  }

  const now = new Date();
  const resolvedStatus = status || VisitSessionStatus.ON_SITE;
  const session = await VisitSession.create({
    branchId,
    externalPersonId,
    invitationId: invitationId || null,
    personType: personType || person.type,
    method: parseMethod(method),
    hostStaffId: hostStaffId || null,
    hostName: hostName || "",
    purposeOfVisit: purposeOfVisit || "",
    kioskId: kioskId || null,
    status: resolvedStatus,
    arrivedAt: now,
    checkInAt: now,
    checkOutAt: null,
    policiesSigned: policiesSigned || [],
  });

  return session.toObject();
};

const checkIn = async ({
  actor,
  organizationId,
  branchId,
  externalPersonId,
  method,
  purposeOfVisit,
  hostStaffId,
  hostName,
  kioskId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, branchId);
  await assertBranchInOrganization(branchId, organizationId);

  return createVisitSession({
    organizationId,
    branchId,
    externalPersonId,
    method,
    purposeOfVisit,
    hostStaffId,
    hostName,
    kioskId,
    status: VisitSessionStatus.ON_SITE,
  });
};

const loadManagedVisitSession = async ({
  actor,
  organizationId,
  visitSessionId,
}) => {
  const session = await VisitSession.findById(visitSessionId);
  if (!session) throw new AppError("visit_session_not_found", 404);

  await assertBranchInOrganization(session.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, session.branchId);
  return session;
};

const requireAwaitingApproval = (session) => {
  if (session.status !== VisitSessionStatus.AWAITING_APPROVAL) {
    throw new AppError("visit_not_awaiting_approval", 409);
  }
};

const approveVisitSession = async ({
  actor,
  organizationId,
  visitSessionId,
}) => {
  const session = await loadManagedVisitSession({
    actor,
    organizationId,
    visitSessionId,
  });
  requireAwaitingApproval(session);

  session.status = VisitSessionStatus.ON_SITE;
  if (!session.checkInAt) session.checkInAt = new Date();
  await session.save();
  return session.toObject();
};

const denyVisitSession = async ({
  actor,
  organizationId,
  visitSessionId,
}) => {
  const session = await loadManagedVisitSession({
    actor,
    organizationId,
    visitSessionId,
  });
  requireAwaitingApproval(session);

  session.status = VisitSessionStatus.DENIED;
  await session.save();
  return session.toObject();
};

/**
 * Convenience: create ExternalPerson + check-in in one call (walk-in for drills).
 */
const registerAndCheckIn = async ({
  actor,
  organizationId,
  branchId,
  type,
  name,
  email,
  phone,
  method,
  purposeOfVisit,
  hostStaffId,
  hostName,
}) => {
  const externalPersonService = require("./externalPersonService");
  const person = await externalPersonService.createExternalPerson({
    actor,
    organizationId,
    branchId,
    type,
    name,
    email,
    phone,
  });

  const session = await checkIn({
    actor,
    organizationId,
    branchId,
    externalPersonId: person._id,
    method,
    purposeOfVisit,
    hostStaffId,
    hostName,
  });

  return { person, session };
};

const checkOut = async ({
  actor,
  organizationId,
  visitSessionId,
}) => {
  const session = await VisitSession.findById(visitSessionId);
  if (!session) throw new AppError("visit_session_not_found", 404);

  await assertBranchInOrganization(session.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, session.branchId);

  if (session.status !== VisitSessionStatus.ON_SITE || session.checkOutAt) {
    throw new AppError("visit_not_on_site", 409);
  }

  session.status = VisitSessionStatus.CHECKED_OUT;
  session.checkOutAt = new Date();
  await session.save();
  return session.toObject();
};

const listVisitSessions = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  personType,
  status,
  method,
  from,
  to,
  externalPersonId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);

  // Reuse branch resolution + date/type validation from the shared query module.
  parsePersonTypes(personType);
  parseStatuses(status);
  parseDateRange({ from, to });

  const branchFilter = { organizationId };
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchFilter._id = scopedBranchId;
  }
  const branches = await Branch.find(branchFilter).select("_id").lean();
  const branchIds = branches.map((b) => b._id);
  if (!branchIds.length) {
    return emptyVisitSessionList(page, limit);
  }

  const match = { branchId: { $in: branchIds } };
  if (personType) {
    const types = parsePersonTypes(personType);
    match.personType = types.length === 1 ? types[0] : { $in: types };
  }
  if (externalPersonId) {
    match.externalPersonId = toObjectId(externalPersonId);
  }
  if (method) match.method = parseMethod(method);
  const { fromDate, toDate } = parseDateRange({ from, to });
  if (fromDate || toDate) {
    match.checkInAt = {};
    if (fromDate) match.checkInAt.$gte = fromDate;
    if (toDate) match.checkInAt.$lte = toDate;
  }

  const countMatch = { ...match };
  if (status) {
    const statuses = parseStatuses(status);
    match.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  const { data, meta, result } = await paginateWithFacet({
    model: VisitSession,
    match,
    page,
    limit,
    skip,
    sort: { checkInAt: -1 },
    extraDataStages: visitDetailStages,
    extraFacets: visitSessionStatusCountFacets(countMatch),
  });

  return {
    data: data.map(shapeVisitRow),
    meta: {
      ...meta,
      counts: result
        ? visitSessionStatusCountsFromFacet(result)
        : emptyVisitSessionStatusCounts(),
    },
  };
};

const getVisitSession = async ({
  actor,
  organizationId,
  visitSessionId,
}) => {
  const [session] = await VisitSession.aggregate([
    { $match: { _id: toObjectId(visitSessionId) } },
    ...visitDetailStages,
  ]);
  if (!session) throw new AppError("visit_session_not_found", 404);

  await assertBranchInOrganization(session.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, session.branchId);
  if (String(scoped) !== String(session.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }

  return shapeVisitRow(session);
};

/**
 * On-site counts for visitors/contractors (Figma Screen 86 style).
 */
const getOnSiteCounts = async ({
  actor,
  organizationId,
  branchId,
  personType,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (branchId) await assertBranchInOrganization(branchId, organizationId);

  const result = await countVisitPresenceByType({
    organizationId,
    branchId: scopedBranchId || undefined,
    personType,
    onSiteOnly: true,
  });

  return {
    branchId: scopedBranchId || branchId || null,
    onSiteOnly: true,
    total: result.total,
    counts: {
      visitors: result.counts.visitor || 0,
      contractors: result.counts.contractor || 0,
      guests: result.counts.guest || 0,
    },
  };
};

/**
 * Visit analytics — one parameterized aggregation (type / site / day / status).
 */
const getVisitAnalytics = async ({
  actor,
  organizationId,
  branchId,
  personType,
  status,
  from,
  to,
  groupBy,
  onSiteOnly,
  timezone,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (branchId) await assertBranchInOrganization(branchId, organizationId);

  return aggregateVisitPresence({
    organizationId,
    branchId: scopedBranchId || undefined,
    personType,
    status,
    from,
    to,
    groupBy,
    onSiteOnly,
    timezone,
  });
};

const emptyVisitorCheckInKpis = () => ({
  onSite: 0,
  visitors: 0,
  contractors: 0,
});

const emptyVisitorCheckInsReport = ({
  page,
  limit,
  from,
  to,
  timezone,
  branchId,
}) => ({
  from,
  to,
  timezone,
  branchId: branchId || null,
  kpis: emptyVisitorCheckInKpis(),
  rows: [],
  meta: {
    ...generateMeta(page, limit, 0),
    counts: emptyVisitSessionStatusCounts(),
  },
});

const resolveVisitorReportRange = ({ from, to, timezone }) => {
  const fromRaw = from && String(from).trim();
  const toRaw = to && String(to).trim();
  if (fromRaw || toRaw) {
    const range = parseDateRange({
      from: fromRaw,
      to: toRaw,
      timezone,
    });
    const tz = range.timezone;
    return {
      ...range,
      from: range.fromDate
        ? moment(range.fromDate).tz(tz).format("YYYY-MM-DD")
        : null,
      to: range.toDate
        ? moment(range.toDate).tz(tz).format("YYYY-MM-DD")
        : null,
    };
  }

  const tz = timezone || "Europe/London";
  const fromDay = moment.tz(tz).startOf("month");
  const toDay = moment.tz(tz).endOf("month");
  return {
    fromDate: fromDay.toDate(),
    toDate: toDay.toDate(),
    timezone: tz,
    from: fromDay.format("YYYY-MM-DD"),
    to: toDay.format("YYYY-MM-DD"),
  };
};

const visitorCheckInsReport = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  departmentId,
  personType,
  status,
  keyword,
  from,
  to,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);

  parsePersonTypes(personType);
  parseStatuses(status);

  const branchFilter = { organizationId };
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchFilter._id = scopedBranchId;
  }

  const branches = await Branch.find(branchFilter)
    .select("_id timezone")
    .lean();
  const tz =
    (scopedBranchId
      ? branches[0]?.timezone
      : branches.length === 1
        ? branches[0].timezone
        : "Europe/London") || "Europe/London";
  const range = resolveVisitorReportRange({ from, to, timezone: tz });

  if (!branches.length) {
    return emptyVisitorCheckInsReport({
      page,
      limit,
      from: range.from,
      to: range.to,
      timezone: range.timezone,
      branchId: scopedBranchId || null,
    });
  }

  const match = {
    branchId: { $in: branches.map((row) => row._id) },
  };
  if (personType) {
    const types = parsePersonTypes(personType);
    match.personType = types.length === 1 ? types[0] : { $in: types };
  }
  if (range.fromDate || range.toDate) {
    match.checkInAt = {};
    if (range.fromDate) match.checkInAt.$gte = range.fromDate;
    if (range.toDate) match.checkInAt.$lte = range.toDate;
  }

  const personMatch = {};
  if (departmentId) {
    personMatch["person.departmentId"] = toObjectId(
      departmentId,
      "invalid_department_id"
    );
  }
  const search = keywordOr(keyword, ["person.name", "person.email"], {
    trim: true,
  });
  if (search) personMatch.$or = search;

  const needsPerson = Boolean(departmentId || search);
  const personStages = needsPerson
    ? [
        {
          $lookup: {
            from: ExternalPerson.collection.name,
            localField: "externalPersonId",
            foreignField: "_id",
            pipeline: [
              {
                $project: {
                  name: 1,
                  email: 1,
                  departmentId: 1,
                },
              },
              { $limit: 1 },
            ],
            as: "_personFilter",
          },
        },
        {
          $addFields: {
            person: { $arrayElemAt: ["$_personFilter", 0] },
          },
        },
        { $match: personMatch },
        { $project: { _personFilter: 0, person: 0 } },
      ]
    : [];

  const listMatch = [];
  if (status) {
    const statuses = parseStatuses(status);
    listMatch.push({
      $match: {
        status: statuses.length === 1 ? statuses[0] : { $in: statuses },
      },
    });
  }

  const [result] = await VisitSession.aggregate([
    { $match: match },
    ...personStages,
    {
      $facet: {
        kpis: [
          {
            $group: {
              _id: null,
              onSite: {
                $sum: {
                  $cond: [
                    { $eq: ["$status", VisitSessionStatus.ON_SITE] },
                    1,
                    0,
                  ],
                },
              },
              visitors: {
                $sum: {
                  $cond: [
                    { $eq: ["$personType", ExternalPersonType.VISITOR] },
                    1,
                    0,
                  ],
                },
              },
              contractors: {
                $sum: {
                  $cond: [
                    { $eq: ["$personType", ExternalPersonType.CONTRACTOR] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        statusCounts: [
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ],
        totalCount: [...listMatch, { $count: "count" }],
        data: [
          ...listMatch,
          { $sort: { checkInAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          ...visitDetailStages,
        ],
      },
    },
  ]);

  const kpiRow = result?.kpis?.[0];
  return {
    from: range.from,
    to: range.to,
    timezone: range.timezone,
    branchId: scopedBranchId || null,
    kpis: {
      onSite: kpiRow?.onSite || 0,
      visitors: kpiRow?.visitors || 0,
      contractors: kpiRow?.contractors || 0,
    },
    rows: (result?.data || []).map(shapeVisitRow),
    meta: {
      ...generateMeta(page, limit, facetCount(result?.totalCount)),
      counts: visitSessionStatusCountsFromFacet(result || {}),
    },
  };
};

module.exports = {
  parseMethod,
  createVisitSession,
  checkIn,
  registerAndCheckIn,
  checkOut,
  approveVisitSession,
  denyVisitSession,
  listVisitSessions,
  getVisitSession,
  getOnSiteCounts,
  getVisitAnalytics,
  visitorCheckInsReport,
};
