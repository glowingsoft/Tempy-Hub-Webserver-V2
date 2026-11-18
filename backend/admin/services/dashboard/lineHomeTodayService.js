const { toObjectId } = require("@appServices/family/familyPipeline");
const { AppError } = require("@services/_errors/AppError");
const { generateMeta } = require("@utils/responseUtil");
const { getFullImageUrl } = require("@utils/imageHelper");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { JobTitle } = require("@models/JobTitle");
const { Shift } = require("@models/Shift");
const { AttendanceDay } = require("@models/AttendanceDay");
const { LeaveRequest } = require("@models/LeaveRequest");
const {
  MembershipRole,
  PresenceStatus,
  PunctualityStatus,
  LeaveType,
  LeaveRequestStatus,
  ShiftStatus,
} = require("@models/domainEnums");
const { actorStanding } = require("@adminServices/staff/staffAccess");
const {
  loadTeamIds,
  loadTimezone,
  resolvePeriod,
} = require("@adminServices/teamLive/teamLiveService");

const TABS = ["onShift", "checkedIn", "late", "sick"];
const ON_SITE = [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK];
const SHIFT_ON = [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED];
const SICK_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.CLOSED,
];
const NIGHT_HOUR = 18;

const parseTab = (tab) => {
  const key = String(tab || "onShift");
  if (!TABS.includes(key)) throw new AppError("invalid_today_tab", 400);
  return key;
};

const emptyCounts = () => ({
  onShift: 0,
  checkedIn: 0,
  late: 0,
  sick: 0,
});

const cardLookups = [
  {
    $lookup: {
      from: StaffProfile.collection.name,
      localField: "_id",
      foreignField: "_id",
      as: "staff",
    },
  },
  { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: User.collection.name,
      localField: "staff.userId",
      foreignField: "_id",
      as: "user",
    },
  },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: JobTitle.collection.name,
      localField: "staff.jobTitleId",
      foreignField: "_id",
      as: "jobTitle",
    },
  },
];

const cardProject = {
  $project: {
    _id: 0,
    staffId: "$_id",
    name: { $ifNull: ["$user.name", ""] },
    photoUrl: {
      $ifNull: ["$staff.photoUrl", { $ifNull: ["$user.profileIcon", ""] }],
    },
    jobTitle: { $ifNull: [{ $arrayElemAt: ["$jobTitle.name", 0] }, ""] },
    startsAt: { $ifNull: ["$startsAt", null] },
    endsAt: { $ifNull: ["$endsAt", null] },
    clockInAt: { $ifNull: ["$clockInAt", null] },
    lateMinutes: { $ifNull: ["$lateMinutes", null] },
    sickReportedAt: { $ifNull: ["$sickReportedAt", null] },
    clockedIn: { $cond: [{ $ifNull: ["$clockInAt", false] }, true, false] },
  },
};

const pageRows = (skip, limit) => [
  { $skip: skip },
  { $limit: Math.max(limit, 1) },
  ...cardLookups,
  cardProject,
];

const facetOf = (includeRows, skip, limit, extraRowStages = []) => ({
  total: [{ $count: "count" }],
  ...(includeRows
    ? { rows: [...extraRowStages, ...pageRows(skip, limit)] }
    : {}),
});

const countOf = (facet) => facet?.total?.[0]?.count || 0;

const onShiftFacet = async ({ ids, from, to, includeRows, skip, limit }) => {
  if (!ids.length) return { total: 0, rows: [] };
  const [facet] = await Shift.aggregate([
    {
      $match: {
        staffId: { $in: ids },
        status: { $in: SHIFT_ON },
        startsAt: { $lt: to },
        endsAt: { $gt: from },
      },
    },
    { $sort: { startsAt: 1 } },
    {
      $group: {
        _id: "$staffId",
        startsAt: { $first: "$startsAt" },
        endsAt: { $first: "$endsAt" },
      },
    },
    { $facet: facetOf(includeRows, skip, limit, [{ $sort: { startsAt: 1 } }]) },
  ]);
  return { total: countOf(facet), rows: facet?.rows || [] };
};

const attendanceFacets = async ({
  ids,
  todayWork,
  now,
  tab,
  skip,
  limit,
}) => {
  if (!ids.length) {
    return { checkedIn: 0, late: 0, rows: [] };
  }

  const lateMinutes = {
    $max: [
      0,
      {
        $round: [
          {
            $divide: [
              {
                $subtract: [
                  { $ifNull: ["$clockInAt", now] },
                  { $ifNull: ["$startsAt", { $ifNull: ["$clockInAt", now] }] },
                ],
              },
              60000,
            ],
          },
          0,
        ],
      },
    ],
  };

  const [facet] = await AttendanceDay.aggregate([
    { $match: { staffId: { $in: ids }, workDate: todayWork } },
    {
      $lookup: {
        from: Shift.collection.name,
        localField: "shiftId",
        foreignField: "_id",
        as: "shift",
      },
    },
    {
      $addFields: {
        startsAt: { $ifNull: [{ $arrayElemAt: ["$shift.startsAt", 0] }, null] },
        endsAt: { $ifNull: [{ $arrayElemAt: ["$shift.endsAt", 0] }, null] },
      },
    },
    {
      $facet: {
        checkedIn: [
          { $match: { presenceStatus: { $in: ON_SITE } } },
          { $group: { _id: "$staffId", clockInAt: { $max: "$clockInAt" }, startsAt: { $first: "$startsAt" }, endsAt: { $first: "$endsAt" } } },
          { $count: "count" },
        ],
        late: [
          { $match: { punctualityStatus: PunctualityStatus.LATE } },
          {
            $group: {
              _id: "$staffId",
              clockInAt: { $max: "$clockInAt" },
              startsAt: { $first: "$startsAt" },
              endsAt: { $first: "$endsAt" },
            },
          },
          { $count: "count" },
        ],
        ...(tab === "checkedIn"
          ? {
              rows: [
                { $match: { presenceStatus: { $in: ON_SITE } } },
                {
                  $group: {
                    _id: "$staffId",
                    clockInAt: { $max: "$clockInAt" },
                    startsAt: { $first: "$startsAt" },
                    endsAt: { $first: "$endsAt" },
                  },
                },
                { $sort: { clockInAt: -1 } },
                ...pageRows(skip, limit),
              ],
            }
          : {}),
        ...(tab === "late"
          ? {
              rows: [
                { $match: { punctualityStatus: PunctualityStatus.LATE } },
                {
                  $group: {
                    _id: "$staffId",
                    clockInAt: { $max: "$clockInAt" },
                    startsAt: { $first: "$startsAt" },
                    endsAt: { $first: "$endsAt" },
                  },
                },
                { $addFields: { lateMinutes } },
                { $sort: { lateMinutes: -1 } },
                ...pageRows(skip, limit),
              ],
            }
          : {}),
      },
    },
  ]);

  return {
    checkedIn: facet?.checkedIn?.[0]?.count || 0,
    late: facet?.late?.[0]?.count || 0,
    rows: facet?.rows || [],
  };
};

const sickFacet = async ({ ids, from, to, includeRows, skip, limit }) => {
  if (!ids.length) return { total: 0, rows: [] };
  const [facet] = await LeaveRequest.aggregate([
    {
      $match: {
        staffId: { $in: ids },
        leaveType: LeaveType.SICK,
        status: { $in: SICK_STATUSES },
        startDate: { $lte: to },
        endDate: { $gte: from },
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$staffId",
        sickReportedAt: { $first: "$createdAt" },
        shiftId: { $first: "$shiftId" },
      },
    },
    {
      $lookup: {
        from: Shift.collection.name,
        localField: "shiftId",
        foreignField: "_id",
        as: "shift",
      },
    },
    {
      $addFields: {
        startsAt: { $ifNull: [{ $arrayElemAt: ["$shift.startsAt", 0] }, null] },
        endsAt: { $ifNull: [{ $arrayElemAt: ["$shift.endsAt", 0] }, null] },
      },
    },
    {
      $facet: facetOf(includeRows, skip, limit, [
        { $sort: { sickReportedAt: -1 } },
      ]),
    },
  ]);
  return { total: countOf(facet), rows: facet?.rows || [] };
};

const uncoveredNightOf = async ({ organizationId, branchId, from, to, tz }) => {
  const found = await Shift.exists({
    organizationId: toObjectId(organizationId),
    branchId: toObjectId(branchId),
    status: ShiftStatus.OPEN,
    staffId: null,
    startsAt: { $gte: from, $lte: to },
    $expr: {
      $gte: [{ $hour: { date: "$startsAt", timezone: tz } }, NIGHT_HOUR],
    },
  });
  return Boolean(found);
};

const getLineHomeToday = async ({
  actor,
  organizationId,
  tab: tabQuery,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const standing = await actorStanding(actor, organizationId);
  if (standing.role !== MembershipRole.LINE_MANAGER) {
    throw new AppError("insufficient_role", 403);
  }
  if (!standing.branchId) throw new AppError("branch_scope_required", 400);

  const tab = parseTab(tabQuery);
  const tz = await loadTimezone(standing);
  const { from, to } = resolvePeriod("daily", tz);
  const fromDate = from.toDate();
  const toDate = to.toDate();
  const todayWork = new Date(`${from.format("YYYY-MM-DD")}T00:00:00.000Z`);
  const teamIds = await loadTeamIds({ actor, organizationId, standing });
  const ids = teamIds.map((id) => toObjectId(id));

  const counts = emptyCounts();
  if (!ids.length) {
    return {
      data: [],
      meta: {
        ...generateMeta(page, limit, 0),
        tab,
        counts,
        uncoveredNightShift: false,
      },
    };
  }

  const [onShift, attendance, sick, uncoveredNightShift] = await Promise.all([
    onShiftFacet({
      ids,
      from: fromDate,
      to: toDate,
      includeRows: tab === "onShift",
      skip,
      limit,
    }),
    attendanceFacets({
      ids,
      todayWork,
      now,
      tab,
      skip,
      limit,
    }),
    sickFacet({
      ids,
      from: fromDate,
      to: toDate,
      includeRows: tab === "sick",
      skip,
      limit,
    }),
    uncoveredNightOf({
      organizationId,
      branchId: standing.branchId,
      from: fromDate,
      to: toDate,
      tz,
    }),
  ]);

  counts.onShift = onShift.total;
  counts.checkedIn = attendance.checkedIn;
  counts.late = attendance.late;
  counts.sick = sick.total;

  const rows =
    tab === "onShift"
      ? onShift.rows
      : tab === "sick"
        ? sick.rows
        : attendance.rows;
  const total = counts[tab];

  return {
    data: rows.map((row) => ({
      ...row,
      photoUrl: getFullImageUrl(row.photoUrl),
    })),
    meta: {
      ...generateMeta(page, limit, total),
      tab,
      counts,
      uncoveredNightShift,
    },
  };
};

module.exports = { getLineHomeToday, TABS };
