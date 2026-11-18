const mongoose = require("mongoose");
const { AttendanceDay } = require("@models/AttendanceDay");
const { VisitSession } = require("@models/VisitSession");
const { StaffProfile } = require("@models/StaffProfile");
const { ExternalPerson } = require("@models/ExternalPerson");
const { JobTitle } = require("@models/JobTitle");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { Department } = require("@models/Department");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyVisit } = require("@models/FamilyVisit");
const { PersonCategory } = require("@models/PersonCategory");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { generateMeta } = require("@utils/responseUtil");
const { facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  VisitSessionStatus,
  VisitMethod,
  InvitationStatus,
  ExternalPersonType,
  PresenceStatus,
  AdmissionStatus,
  StaffProfileStatus,
  FamilyMemberStatus,
  FamilyVisitStatus,
  FamilyVisitSource,
} = require("@models/domainEnums");
const { loadMyStatus } = require("./myStatus");
const {
  actorStanding,
  assertMayManageStaff,
  scopeBranchFilter,
  assertBranchInOrganization,
} = require("@adminServices/staff/staffAccess");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const visitSessionService = require("@adminServices/visitors/visitSessionService");
const visitorInvitationService = require("@adminServices/visitors/visitorInvitationService");
const kioskService = require("@adminServices/kiosk/kioskService");
const attendanceService = require("@adminServices/attendance/attendanceService");
const signOutReminder = require("./signOutReminder");
const { getAttention } = require("@adminServices/family/familyWallActivityService");
const { getWallGazetteCard } = require("@adminServices/family/familyGazetteCard");
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
  lastCheckInAt: row.lastCheckInAt || null,
  kioskMode: row.kioskMode || null,
});

const getSiteLive = async ({
  actor,
  organizationId,
  branchId,
  familyOn = false,
}) => {
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
    homeCards,
  ] =
    await Promise.all([
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
      getHomeCards({
        organizationId,
        branchId: liveBranchId,
        familyOn,
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
    cards: homeCards.cards,
    family: homeCards.family,
    agency: null,
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

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;
const SOURCE_LIMIT = 500;
const ON_SITE_PRESENCE = [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK];
const KINDS = ["staff", ...Object.values(ExternalPersonType)];
const VISITOR_TYPES = [ExternalPersonType.VISITOR, ExternalPersonType.GUEST];
const CONTRACTOR_TYPES = [
  ExternalPersonType.CONTRACTOR,
  ExternalPersonType.PROFESSIONAL,
];
const PEOPLE_TABS = [
  "staff",
  "residents",
  "visitors",
  "contractors",
  "residentsOut",
  "didNotSignOut",
];

const toId = (value) => new mongoose.Types.ObjectId(String(value));

const parseTab = (value) => {
  if (value == null || value === "") return "staff";
  const tab = String(value).trim();
  if (!PEOPLE_TABS.includes(tab)) throw new AppError("invalid_people_tab", 400);
  return tab;
};

const parseKind = (value) => {
  const kind = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!KINDS.includes(kind)) throw new AppError("invalid_person_kind", 400);
  return kind;
};

const parseDays = (value) => {
  if (value == null || value === "") return DEFAULT_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new AppError("invalid_not_signed_out_days", 400);
  }
  return days;
};

const startOfToday = () => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
};

const first = (path) => ({ $arrayElemAt: [path, 0] });

const withPublicPhoto = (row) => ({
  ...row,
  photoUrl: toPublicImageUrl(row.photoUrl) || "",
});

const staffLookups = [
  {
    $lookup: {
      from: StaffProfile.collection.name,
      localField: "staffId",
      foreignField: "_id",
      as: "_staff",
    },
  },
  {
    $lookup: {
      from: User.collection.name,
      localField: "_staff.userId",
      foreignField: "_id",
      as: "_user",
    },
  },
  {
    $lookup: {
      from: JobTitle.collection.name,
      localField: "_staff.jobTitleId",
      foreignField: "_id",
      as: "_jobTitle",
    },
  },
];

const staffFields = {
  personKind: { $literal: "staff" },
  personId: "$staffId",
  branchId: 1,
  name: { $ifNull: [first("$_user.name"), ""] },
  photoUrl: { $ifNull: [first("$_staff.photoUrl"), ""] },
  employeeCode: { $ifNull: [first("$_staff.employeeCode"), ""] },
  jobTitle: { $ifNull: [first("$_jobTitle.name"), ""] },
  signedInAt: "$clockInAt",
};

const personLookup = {
  $lookup: {
    from: ExternalPerson.collection.name,
    localField: "externalPersonId",
    foreignField: "_id",
    as: "_person",
  },
};

const visitFields = {
  personKind: "$personType",
  personId: "$externalPersonId",
  branchId: 1,
  name: { $ifNull: [first("$_person.name"), ""] },
  photoUrl: { $ifNull: [first("$_person.photoUrl"), ""] },
  category: { $ifNull: [first("$_person.visitorCategory"), ""] },
  method: 1,
  visitPurpose: { $ifNull: ["$purposeOfVisit", ""] },
  hostName: { $ifNull: ["$hostName", ""] },
  signedInAt: "$checkInAt",
};

const staffOnSiteMatch = (branchIds, todayStart) => ({
  branchId: { $in: branchIds },
  workDate: todayStart,
  presenceStatus: { $in: ON_SITE_PRESENCE },
  clockOutAt: null,
});

const visitOnSiteMatch = (branchIds, personTypes) => ({
  branchId: { $in: branchIds },
  status: VisitSessionStatus.ON_SITE,
  checkOutAt: null,
  personType: { $in: personTypes },
});

const residentMatch = (organizationId, branchIds, isOut) => ({
  organizationId: toId(organizationId),
  branchId: { $in: branchIds },
  admissionStatus: AdmissionStatus.ADMITTED,
  isOut: isOut ? true : { $ne: true },
});

const staffOnSiteRows = ({ branchIds, todayStart, skip, limit }) =>
  AttendanceDay.aggregate([
    { $match: staffOnSiteMatch(branchIds, todayStart) },
    { $sort: { clockInAt: 1 } },
    { $skip: skip },
    { $limit: limit },
    ...staffLookups,
    {
      $project: {
        _id: 1,
        ...staffFields,
        onBreak: { $eq: ["$presenceStatus", PresenceStatus.ON_BREAK] },
        canCheckOut: { $literal: true },
      },
    },
  ]);

const visitOnSiteRows = ({ branchIds, personTypes, skip, limit }) =>
  VisitSession.aggregate([
    { $match: visitOnSiteMatch(branchIds, personTypes) },
    { $sort: { checkInAt: 1 } },
    { $skip: skip },
    { $limit: limit },
    personLookup,
    {
      $project: {
        _id: 1,
        ...visitFields,
        canCheckOut: { $literal: true },
      },
    },
  ]);

const residentRows = ({ organizationId, branchIds, isOut, skip, limit }) =>
  Resident.aggregate([
    { $match: residentMatch(organizationId, branchIds, isOut) },
    { $sort: { name: 1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        personKind: { $literal: "resident" },
        branchId: 1,
        name: 1,
        photoUrl: { $ifNull: ["$photoUrl", ""] },
        roomNumber: { $ifNull: ["$roomNumber", ""] },
        restricted: { $eq: ["$restricted", true] },
        out: {
          destination: { $ifNull: ["$outDestination", ""] },
          note: { $ifNull: ["$outNote", ""] },
          since: { $ifNull: ["$outSince", null] },
          expectedReturnAt: { $ifNull: ["$expectedReturnAt", null] },
        },
        canCheckOut: { $literal: false },
      },
    },
  ]);

const missedStaffRows = (branchIds, since, todayStart) =>
  AttendanceDay.aggregate([
    {
      $match: {
        branchId: { $in: branchIds },
        clockInAt: { $gte: since, $lt: todayStart },
        signOutResolvedAt: null,
        $or: [{ clockOutAt: null }, { autoClosed: true }],
      },
    },
    { $sort: { clockInAt: -1 } },
    { $limit: SOURCE_LIMIT },
    ...staffLookups,
    {
      $project: {
        _id: 1,
        ...staffFields,
        visitPurpose: { $literal: "" },
        signedOutAt: {
          $cond: [{ $eq: ["$autoClosed", true] }, "$clockOutAt", null],
        },
        autoClosed: { $eq: ["$autoClosed", true] },
        canCheckOut: { $literal: true },
      },
    },
  ]);

const missedVisitRows = (branchIds, since, todayStart) =>
  VisitSession.aggregate([
    {
      $match: {
        branchId: { $in: branchIds },
        checkInAt: { $gte: since, $lt: todayStart },
        signOutResolvedAt: null,
        $or: [
          { status: VisitSessionStatus.ON_SITE, checkOutAt: null },
          { autoClosed: true },
        ],
      },
    },
    { $sort: { checkInAt: -1 } },
    { $limit: SOURCE_LIMIT },
    personLookup,
    {
      $project: {
        _id: 1,
        ...visitFields,
        employeeCode: { $literal: "" },
        jobTitle: { $literal: "" },
        signedOutAt: {
          $cond: [{ $eq: ["$autoClosed", true] }, "$checkOutAt", null],
        },
        autoClosed: { $eq: ["$autoClosed", true] },
        canCheckOut: { $literal: true },
      },
    },
  ]);

const loadMissedSignOuts = async (branchIds, lookbackDays, todayStart) => {
  const since = new Date(todayStart.getTime() - lookbackDays * DAY_MS);
  const [staff, visits] = await Promise.all([
    missedStaffRows(branchIds, since, todayStart),
    missedVisitRows(branchIds, since, todayStart),
  ]);
  return [...staff, ...visits]
    .map((row) => ({
      ...row,
      status: row.autoClosed ? "autoSignedOut" : "stillSignedIn",
    }))
    .sort((a, b) => new Date(b.signedInAt) - new Date(a.signedInAt));
};

const familyCards = async ({ organizationId, branchId, now }) => {
  const scope = {
    organizationId: toId(organizationId),
    branchId: toId(branchId),
  };
  const [attention, gazette, joins, visits] = await Promise.all([
    getAttention({ organizationId, branchId }),
    getWallGazetteCard({ organizationId, branchId, now }),
    FamilyMember.countDocuments({
      ...scope,
      status: FamilyMemberStatus.PENDING,
    }),
    FamilyVisit.countDocuments({
      ...scope,
      source: FamilyVisitSource.FAMILY,
      status: FamilyVisitStatus.REQUESTED,
      endAt: { $gt: now },
    }),
  ]);
  return {
    photos: attention.pendingUploads.count,
    joins,
    visits,
    reports: attention.reportedPosts.count,
    gazette: gazette?.scheduled
      ? {
          number: gazette.number,
          closesInDays: gazette.closesInDays,
          residentsWithNoContent: gazette.residents.noContent,
        }
      : null,
  };
};

const getHomeCards = async ({ organizationId, branchId, familyOn }) => {
  const branchIds = [toId(branchId)];
  const [residentsOut, restricted, missed, family] = await Promise.all([
    Resident.countDocuments(residentMatch(organizationId, branchIds, true)),
    Resident.countDocuments({
      organizationId: toId(organizationId),
      branchId: { $in: branchIds },
      admissionStatus: AdmissionStatus.ADMITTED,
      restricted: true,
    }),
    loadMissedSignOuts(branchIds, 1, startOfToday()),
    familyOn
      ? familyCards({ organizationId, branchId, now: new Date() })
      : null,
  ]);
  return {
    cards: { residentsOut, didNotSignOut: missed.length, restricted },
    family,
  };
};

const resolvePeopleScope = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayManageStaff(standing, scopedBranchId);
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
  }
  const branchIds = scopedBranchId
    ? [toId(scopedBranchId)]
    : (
        await Branch.aggregate([
          { $match: { organizationId: toId(organizationId) } },
          { $project: { _id: 1 } },
        ])
      ).map((branch) => branch._id);
  return { standing, branchIds };
};

const listPeople = async ({
  actor,
  organizationId,
  branchId,
  tab,
  days,
  page,
  limit,
  skip,
}) => {
  const activeTab = parseTab(tab);
  const lookbackDays = parseDays(days);
  const { branchIds } = await resolvePeopleScope({
    actor,
    organizationId,
    branchId,
  });
  const todayStart = startOfToday();

  const [
    staffCount,
    residentCount,
    outCount,
    visitorCount,
    contractorCount,
    missed,
  ] = await Promise.all([
    AttendanceDay.countDocuments(staffOnSiteMatch(branchIds, todayStart)),
    Resident.countDocuments(residentMatch(organizationId, branchIds, false)),
    Resident.countDocuments(residentMatch(organizationId, branchIds, true)),
    VisitSession.countDocuments(visitOnSiteMatch(branchIds, VISITOR_TYPES)),
    VisitSession.countDocuments(visitOnSiteMatch(branchIds, CONTRACTOR_TYPES)),
    loadMissedSignOuts(branchIds, lookbackDays, todayStart),
  ]);

  const tabCounts = {
    staff: staffCount,
    residents: residentCount,
    visitors: visitorCount,
    contractors: contractorCount,
    residentsOut: outCount,
    didNotSignOut: missed.length,
  };

  const loaders = {
    staff: () => staffOnSiteRows({ branchIds, todayStart, skip, limit }),
    visitors: () =>
      visitOnSiteRows({ branchIds, personTypes: VISITOR_TYPES, skip, limit }),
    contractors: () =>
      visitOnSiteRows({
        branchIds,
        personTypes: CONTRACTOR_TYPES,
        skip,
        limit,
      }),
    residents: () =>
      residentRows({ organizationId, branchIds, isOut: false, skip, limit }),
    residentsOut: () =>
      residentRows({ organizationId, branchIds, isOut: true, skip, limit }),
    didNotSignOut: async () => missed.slice(skip, skip + limit),
  };

  const rows = await loaders[activeTab]();

  return {
    data: rows.map(withPublicPhoto),
    meta: {
      ...generateMeta(page, limit, tabCounts[activeTab]),
      tab: activeTab,
      tabCounts,
      ...(activeTab === "didNotSignOut" ? { days: lookbackDays } : {}),
    },
  };
};

const parseCheckOutTime = (value, signedInAt) => {
  const now = new Date();
  if (value == null || value === "") return now;
  const when = new Date(value);
  if (
    Number.isNaN(when.getTime()) ||
    when < new Date(signedInAt) ||
    when > now
  ) {
    throw new AppError("invalid_check_out_time", 400);
  }
  return when;
};

const checkOutPerson = async ({
  actor,
  organizationId,
  personKind,
  recordId,
  checkOutAt,
}) => {
  const kind = parseKind(personKind);
  const isStaff = kind === "staff";
  const Record = isStaff ? AttendanceDay : VisitSession;
  const record = mongoose.isValidObjectId(recordId)
    ? await Record.findById(recordId).lean()
    : null;
  if (!record || (!isStaff && record.personType !== kind)) {
    throw new AppError("people_record_not_found", 404);
  }

  await assertBranchInOrganization(record.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, record.branchId);

  const signedInAt = isStaff ? record.clockInAt : record.checkInAt;
  const open = isStaff
    ? !record.clockOutAt
    : record.status === VisitSessionStatus.ON_SITE && !record.checkOutAt;
  if (record.signOutResolvedAt || (!open && !record.autoClosed)) {
    throw new AppError("people_already_signed_out", 409);
  }

  const missed = new Date(signedInAt) < startOfToday();
  let signedOutAt = record.clockOutAt || record.checkOutAt || null;

  if (open) {
    signedOutAt = parseCheckOutTime(checkOutAt, signedInAt);
    if (isStaff) {
      const profile = await StaffProfile.findById(record.staffId);
      if (!profile) throw new AppError("people_record_not_found", 404);
      await attendanceService.clockOutForStaff({
        staffProfile: profile,
        branchId: record.branchId,
        occurredAt: signedOutAt,
      });
    } else {
      const closed = await VisitSession.updateOne(
        {
          _id: record._id,
          status: VisitSessionStatus.ON_SITE,
          checkOutAt: null,
        },
        {
          $set: {
            status: VisitSessionStatus.CHECKED_OUT,
            checkOutAt: signedOutAt,
          },
        },
      );
      if (closed.modifiedCount !== 1) {
        throw new AppError("people_already_signed_out", 409);
      }
    }
  }

  if (missed) {
    await Record.updateOne(
      { _id: record._id },
      {
        $set: {
          signOutResolvedAt: new Date(),
          signOutResolvedByUserId: actor._id,
        },
      },
    );
    if (isStaff) {
      await signOutReminder.queueStaffReminder(record.staffId, signedInAt);
    } else if (record.externalPersonId) {
      await signOutReminder.queueExternalReminder(
        record.externalPersonId,
        signedInAt,
      );
    }
  }

  return {
    _id: record._id,
    personKind: kind,
    signedInAt,
    signedOutAt,
    reminderQueued: missed,
  };
};

const DIRECTORY_TABS = ["staff", "residents", "contractors", "archived"];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDirectoryTab = (value) => {
  if (value == null || value === "") return "staff";
  const tab = String(value).trim();
  if (!DIRECTORY_TABS.includes(tab))
    throw new AppError("invalid_directory_tab", 400);
  return tab;
};

const parseDepartment = (value) => {
  if (value == null || value === "") return null;
  if (!mongoose.isValidObjectId(String(value)))
    throw new AppError("invalid_department_id", 400);
  return toId(value);
};

const parseKeyword = (value) => {
  const text = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return text ? new RegExp(escapeRegex(text), "i") : null;
};

const paged = async (model, pipeline, { sort, skip, limit }) => {
  const [result] = await model.aggregate([
    ...pipeline,
    {
      $facet: {
        data: [{ $sort: sort }, { $skip: skip }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);
  return { rows: result.data, total: facetCount(result.total) };
};

const staffJoins = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "userId",
      foreignField: "_id",
      as: "_user",
    },
  },
  {
    $lookup: {
      from: JobTitle.collection.name,
      localField: "jobTitleId",
      foreignField: "_id",
      as: "_jobTitle",
    },
  },
  {
    $lookup: {
      from: Department.collection.name,
      localField: "departmentIds",
      foreignField: "_id",
      as: "_departments",
    },
  },
];

const staffPipeline = (match, keyword) => [
  { $match: match },
  ...staffJoins,
  { $addFields: { name: { $ifNull: [first("$_user.name"), ""] } } },
  ...(keyword ? [{ $match: { name: keyword } }] : []),
];

const directoryResidentMatch = (
  organizationId,
  branchIds,
  status,
  keyword,
) => ({
  organizationId: toId(organizationId),
  branchId: { $in: branchIds },
  admissionStatus: status,
  ...(keyword ? { $or: [{ name: keyword }, { roomNumber: keyword }] } : {}),
});

const staffRows = async ({ branchIds, departmentId, keyword, ...window }) => {
  const match = {
    branchId: { $in: branchIds },
    status: { $ne: StaffProfileStatus.INACTIVE },
    ...(departmentId ? { departmentIds: departmentId } : {}),
  };
  const { rows, total } = await paged(
    StaffProfile,
    staffPipeline(match, keyword),
    { sort: { name: 1, _id: 1 }, ...window },
  );
  return {
    total,
    rows: rows.map((row) => ({
      _id: row._id,
      personKind: "staff",
      name: row.name,
      photoUrl: row.photoUrl || "",
      jobTitle: row._jobTitle?.[0]?.name || "",
      departments: (row._departments || []).map(
        (department) => department.name,
      ),
    })),
  };
};

const residentDirectoryRows = async ({
  organizationId,
  branchIds,
  keyword,
  ...window
}) => {
  const { rows, total } = await paged(
    Resident,
    [
      {
        $match: directoryResidentMatch(
          organizationId,
          branchIds,
          AdmissionStatus.ADMITTED,
          keyword,
        ),
      },
    ],
    { sort: { name: 1, _id: 1 }, ...window },
  );
  return {
    total,
    rows: rows.map((row) => ({
      _id: row._id,
      personKind: "resident",
      name: row.name,
      photoUrl: row.photoUrl || "",
      roomNumber: row.roomNumber || "",
    })),
  };
};

const contractorRows = async ({ branchIds, keyword, ...window }) => {
  const { rows, total } = await paged(
    ExternalPerson,
    [
      {
        $match: {
          branchId: { $in: branchIds },
          type: { $in: CONTRACTOR_TYPES },
          ...(keyword ? { name: keyword } : {}),
        },
      },
      {
        $lookup: {
          from: PersonCategory.collection.name,
          localField: "categoryId",
          foreignField: "_id",
          as: "_category",
        },
      },
    ],
    { sort: { name: 1, _id: 1 }, ...window },
  );
  return {
    total,
    rows: rows.map((row) => ({
      _id: row._id,
      personKind: row.type,
      name: row.name,
      photoUrl: row.photoUrl || "",
      category: row._category?.[0]?.name || row.visitorCategory || "",
    })),
  };
};

const archivedStaff = async ({ branchIds, keyword, window }) => {
  const { rows, total } = await paged(
    StaffProfile,
    staffPipeline(
      { branchId: { $in: branchIds }, status: StaffProfileStatus.INACTIVE },
      keyword,
    ),
    { sort: { inactiveAt: -1, _id: 1 }, ...window },
  );
  return {
    total,
    rows: rows.map((row) => ({
      _id: row._id,
      personKind: "staff",
      name: row.name,
      photoUrl: row.photoUrl || "",
      departments: (row._departments || []).map(
        (department) => department.name,
      ),
      leftAt: row.inactiveAt || row.updatedAt || null,
    })),
  };
};

const archivedResidents = async ({
  organizationId,
  branchIds,
  keyword,
  window,
}) => {
  const { rows, total } = await paged(
    Resident,
    [
      {
        $match: directoryResidentMatch(
          organizationId,
          branchIds,
          AdmissionStatus.DISCHARGED,
          keyword,
        ),
      },
      {
        $addFields: {
          leftAt: { $ifNull: ["$discharge.dischargedAt", "$updatedAt"] },
        },
      },
    ],
    { sort: { leftAt: -1, _id: 1 }, ...window },
  );
  return {
    total,
    rows: rows.map((row) => ({
      _id: row._id,
      personKind: "resident",
      name: row.name,
      photoUrl: row.photoUrl || "",
      reason: row.discharge?.reason || "",
      leftAt: row.leftAt || null,
    })),
  };
};

const archivedRows = async ({
  organizationId,
  branchIds,
  keyword,
  skip,
  limit,
}) => {
  const window = { skip: 0, limit: skip + limit };
  const [staff, residents] = await Promise.all([
    archivedStaff({ branchIds, keyword, window }),
    archivedResidents({ organizationId, branchIds, keyword, window }),
  ]);
  const merged = [...staff.rows, ...residents.rows].sort(
    (a, b) => new Date(b.leftAt || 0) - new Date(a.leftAt || 0),
  );
  return {
    total: staff.total + residents.total,
    rows: merged.slice(skip, skip + limit),
  };
};

const loadDepartments = async (organizationId, branchIds) =>
  Department.aggregate([
    {
      $match: {
        organizationId: toId(organizationId),
        active: { $ne: false },
        $or: [{ branchId: null }, { branchId: { $in: branchIds } }],
      },
    },
    { $sort: { sortOrder: 1, name: 1 } },
    { $project: { _id: 1, name: 1 } },
  ]);

const listDirectory = async ({
  actor,
  organizationId,
  branchId,
  tab,
  departmentId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const activeTab = parseDirectoryTab(tab);
  const department = parseDepartment(departmentId);
  const search = parseKeyword(keyword);
  const { branchIds } = await resolvePeopleScope({
    actor,
    organizationId,
    branchId,
  });

  const scope = { organizationId, branchIds, keyword: search, skip, limit };
  const loaders = {
    staff: () => staffRows({ ...scope, departmentId: department }),
    residents: () => residentDirectoryRows(scope),
    contractors: () => contractorRows(scope),
    archived: () => archivedRows(scope),
  };

  const [active, count] = await Promise.all([
    loaders[activeTab](),
    Promise.all([
      StaffProfile.countDocuments({
        branchId: { $in: branchIds },
        status: { $ne: StaffProfileStatus.INACTIVE },
      }),
      Resident.countDocuments(
        directoryResidentMatch(
          organizationId,
          branchIds,
          AdmissionStatus.ADMITTED,
        ),
      ),
      ExternalPerson.countDocuments({
        branchId: { $in: branchIds },
        type: { $in: CONTRACTOR_TYPES },
      }),
      StaffProfile.countDocuments({
        branchId: { $in: branchIds },
        status: StaffProfileStatus.INACTIVE,
      }),
      Resident.countDocuments(
        directoryResidentMatch(
          organizationId,
          branchIds,
          AdmissionStatus.DISCHARGED,
        ),
      ),
    ]),
  ]);

  return {
    data: active.rows.map(withPublicPhoto),
    meta: {
      ...generateMeta(page, limit, active.total),
      tab: activeTab,
      tabCounts: {
        staff: count[0],
        residents: count[1],
        contractors: count[2],
        archived: count[3] + count[4],
      },
      ...(activeTab === "staff"
        ? { departments: await loadDepartments(organizationId, branchIds) }
        : {}),
    },
  };
};

module.exports = {
  getSiteLive,
  getSiteLiveActivity,
  resolveLiveBranchId,
  listPeople,
  checkOutPerson,
  listDirectory,
  loadDepartments,
};
