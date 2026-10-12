const { AppError } = require("@services/_errors/AppError");
const {
  VisitSessionStatus,
  VisitMethod,
  InvitationStatus,
} = require("@models/domainEnums");
const { loadMyStatus } = require("./myStatus");
const {
  actorStanding,
  scopeBranchFilter,
  assertBranchInOrganization,
} = require("@adminServices/staff/staffAccess");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const visitSessionService = require("@adminServices/visitors/visitSessionService");
const visitorInvitationService = require("@adminServices/visitors/visitorInvitationService");
const kioskService = require("@adminServices/kiosk/kioskService");
const {
  ACTIVITY_PREVIEW_LIMIT,
  listSiteActivity,
} = require("./siteActivityQuery");

const WALK_IN_PREVIEW = 5;
const PLANNED_PREVIEW = 5;
const KIOSK_LIMIT = 20;

const resolveLiveBranchId = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId);
  if (!scoped) throw new AppError("branch_scope_required", 400);
  await assertBranchInOrganization(scoped, organizationId);
  return scoped;
};

const shapeKiosk = (row) => ({
  _id: row._id,
  locationLabel: row.locationLabel || "",
  receptionIdentifier: row.receptionIdentifier || "",
  presence: row.presence || "offline",
  lastHeartbeatAt: row.lastHeartbeatAt || null,
  kioskMode: row.kioskMode || null,
});

const getSiteLive = async ({ actor, organizationId, branchId }) => {
  const liveBranchId = await resolveLiveBranchId({
    actor,
    organizationId,
    branchId,
  });

  const [
    onSite,
    evacuation,
    walkIns,
    planned,
    kiosks,
    myStatus,
    activity,
  ] = await Promise.all([
    evacuationService.getOnSiteSummary({
      organizationId,
      branchId: liveBranchId,
    }),
    evacuationService.getActiveEvacuation({
      organizationId,
      branchId: liveBranchId,
      includeStats: true,
    }),
    visitSessionService.listVisitSessions({
      actor,
      organizationId,
      branchId: liveBranchId,
      status: VisitSessionStatus.AWAITING_APPROVAL,
      method: VisitMethod.WALK_IN,
      page: 1,
      limit: WALK_IN_PREVIEW,
      skip: 0,
    }),
    visitorInvitationService.listVisitorInvitations({
      actor,
      organizationId,
      branchId: liveBranchId,
      status: InvitationStatus.ACCEPTED,
      page: 1,
      limit: PLANNED_PREVIEW,
      skip: 0,
    }),
    kioskService.listKiosksForAdmin({
      actor,
      organizationId,
      branchId: liveBranchId,
      page: 1,
      limit: KIOSK_LIMIT,
      skip: 0,
    }),
    loadMyStatus({ userId: actor._id, organizationId }),
    listSiteActivity({
      branchId: liveBranchId,
      page: 1,
      limit: ACTIVITY_PREVIEW_LIMIT,
      skip: 0,
    }),
  ]);

  return {
    branch: {
      _id: onSite.branchId,
      name: onSite.branchName,
      assemblyPoint: onSite.assemblyPoint,
    },
    onSite: onSite.counts,
    evacuation: evacuation
      ? { active: true, event: evacuation }
      : { active: false, event: null },
    walkInsAwaiting: {
      count: walkIns.meta?.totalRecords ?? walkIns.meta?.total ?? 0,
      items: walkIns.data,
    },
    plannedVisits: {
      count: planned.meta?.totalRecords ?? planned.meta?.total ?? 0,
      items: planned.data,
    },
    kiosks: (kiosks.data || []).map(shapeKiosk),
    kioskMeta: {
      online: kiosks.meta?.online ?? 0,
      offline: kiosks.meta?.offline ?? 0,
    },
    myStatus,
    recentActivity: {
      items: activity.data,
      hasMore: (activity.meta?.totalRecords || 0) > ACTIVITY_PREVIEW_LIMIT,
    },
  };
};

const getSiteLiveActivity = async ({
  actor,
  organizationId,
  branchId,
  page,
  limit,
  skip,
}) => {
  const liveBranchId = await resolveLiveBranchId({
    actor,
    organizationId,
    branchId,
  });
  return listSiteActivity({
    branchId: liveBranchId,
    page,
    limit,
    skip,
  });
};

module.exports = { getSiteLive, getSiteLiveActivity };
