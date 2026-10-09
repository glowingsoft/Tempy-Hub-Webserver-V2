const { VisitSession } = require("@models/VisitSession");
const { ExternalPerson } = require("@models/ExternalPerson");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  VisitMethod,
  VisitSessionStatus,
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
    return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }

  const match = { branchId: { $in: branchIds } };
  if (personType) {
    const types = parsePersonTypes(personType);
    match.personType = types.length === 1 ? types[0] : { $in: types };
  }
  if (status) {
    const statuses = parseStatuses(status);
    match.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
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

  return paginateWithFacet({
    model: VisitSession,
    match,
    page,
    limit,
    skip,
    sort: { checkInAt: -1 },
  });
};

const getVisitSession = async ({
  actor,
  organizationId,
  visitSessionId,
}) => {
  const session = await VisitSession.findById(visitSessionId).lean();
  if (!session) throw new AppError("visit_session_not_found", 404);

  await assertBranchInOrganization(session.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, session.branchId);
  if (String(scoped) !== String(session.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }

  return session;
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
};
