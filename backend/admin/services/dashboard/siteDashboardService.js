const { toObjectId } = require("@appServices/family/familyPipeline");
const { AppError } = require("@services/_errors/AppError");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { ExternalPerson } = require("@models/ExternalPerson");
const { VisitSession } = require("@models/VisitSession");
const { Resident } = require("@models/Resident");
const { AttendanceDay } = require("@models/AttendanceDay");
const {
  AdmissionStatus,
  ExternalPersonType,
  PresenceStatus,
  RequirementCellStatus,
  VisitSessionStatus,
} = require("@models/domainEnums");
const moment = require("moment-timezone");
const {
  resolvePeriod,
} = require("@adminServices/statistics/statisticsService");
const {
  resolveLiveBranchId,
} = require("@adminServices/siteLive/siteLiveService");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const {
  listSiteActivity,
} = require("@adminServices/siteLive/siteActivityQuery");
const { complianceSnapshot, openShifts } = require("./ownerDashboardService");

const ACTIVITY_PERIODS = ["thisWeek", "thisMonth", "thisYear"];
const ACTIVITY_TZ = "Europe/London";
const PEOPLE_SHOWN = 5;
const ACTIVITY_SHOWN = 6;
const REASONS_SHOWN = 3;
const STAFF = "staff";
const RESIDENT = "resident";
const PEOPLE_FILTERS = [
  STAFF,
  RESIDENT,
  ExternalPersonType.VISITOR,
  ExternalPersonType.CONTRACTOR,
  ExternalPersonType.PROFESSIONAL,
];
const VISITOR_TYPES = [ExternalPersonType.VISITOR, ExternalPersonType.GUEST];
const OTHER_VISITS = [
  ExternalPersonType.CONTRACTOR,
  ExternalPersonType.PROFESSIONAL,
];
const COUNTED_VISITS = [
  VisitSessionStatus.ON_SITE,
  VisitSessionStatus.CHECKED_OUT,
];
const MEETING_ORDER = ["overdue", "dueSoon", "booked", "onTrack", "notYetDue"];
const COUNT_FIELD = {
  [RequirementCellStatus.VALID]: "complete",
  [RequirementCellStatus.DUE_SOON]: "dueSoon",
  [RequirementCellStatus.EXPIRED]: "overdue",
  [RequirementCellStatus.IN_PROGRESS]: "pending",
};

const startOfUtcDay = (date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

const parsePeople = (value) => {
  if (value == null || value === "" || value === "all") return null;
  if (!PEOPLE_FILTERS.includes(value))
    throw new AppError("invalid_people_filter", 400);
  return value;
};

const staffOnSite = async ({ branchId, now }) => {
  const [row] = await AttendanceDay.aggregate([
    {
      $match: {
        branchId,
        workDate: startOfUtcDay(now),
        presenceStatus: {
          $in: [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK],
        },
        clockOutAt: null,
      },
    },
    {
      $facet: {
        total: [{ $count: "count" }],
        rows: [
          { $sort: { clockInAt: -1 } },
          { $limit: PEOPLE_SHOWN },
          {
            $lookup: {
              from: StaffProfile.collection.name,
              localField: "staffId",
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
            $project: {
              _id: 0,
              name: { $ifNull: ["$user.name", ""] },
              email: { $ifNull: ["$user.email", ""] },
              photoUrl: { $ifNull: ["$user.profileIcon", ""] },
              type: { $literal: STAFF },
              checkInAt: "$clockInAt",
              status: "$presenceStatus",
            },
          },
        ],
      },
    },
  ]);
  return { total: row?.total[0]?.count ?? 0, rows: row?.rows ?? [] };
};

const visitorsOnSite = async ({ branchId, type }) => {
  const [row] = await VisitSession.aggregate([
    {
      $match: {
        branchId,
        status: VisitSessionStatus.ON_SITE,
        checkOutAt: null,
        ...(type
          ? {
              personType:
                type === ExternalPersonType.VISITOR
                  ? { $in: VISITOR_TYPES }
                  : type,
            }
          : {}),
      },
    },
    {
      $facet: {
        total: [{ $count: "count" }],
        rows: [
          { $sort: { checkInAt: -1 } },
          { $limit: PEOPLE_SHOWN },
          {
            $lookup: {
              from: ExternalPerson.collection.name,
              localField: "externalPersonId",
              foreignField: "_id",
              as: "person",
            },
          },
          { $unwind: { path: "$person", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              name: { $ifNull: ["$person.name", ""] },
              email: { $ifNull: ["$person.email", ""] },
              photoUrl: { $ifNull: ["$person.photoUrl", ""] },
              type: "$personType",
              checkInAt: 1,
              status: { $literal: PresenceStatus.ON_SITE },
            },
          },
        ],
      },
    },
  ]);
  return { total: row?.total[0]?.count ?? 0, rows: row?.rows ?? [] };
};

const residentsOnSite = async ({ branchId }) => {
  const [row] = await Resident.aggregate([
    { $match: { branchId, admissionStatus: AdmissionStatus.ADMITTED } },
    {
      $facet: {
        total: [{ $count: "count" }],
        rows: [
          { $sort: { admittedAt: -1, name: 1 } },
          { $limit: PEOPLE_SHOWN },
          {
            $project: {
              _id: 0,
              name: 1,
              email: { $ifNull: ["$email", ""] },
              photoUrl: { $ifNull: ["$photoUrl", ""] },
              type: { $literal: RESIDENT },
              checkInAt: { $ifNull: ["$admittedAt", null] },
              status: { $literal: PresenceStatus.ON_SITE },
            },
          },
        ],
      },
    },
  ]);
  return { total: row?.total[0]?.count ?? 0, rows: row?.rows ?? [] };
};

const NOBODY = { total: 0, rows: [] };

const peopleOnSite = async ({ branchId, now, people }) => {
  if (people === RESIDENT) {
    const residents = await residentsOnSite({ branchId });
    return { total: residents.total, people: residents.rows };
  }
  const [staff, visitors] = await Promise.all([
    people && people !== STAFF ? NOBODY : staffOnSite({ branchId, now }),
    people === STAFF ? NOBODY : visitorsOnSite({ branchId, type: people }),
  ]);
  return {
    total: staff.total + visitors.total,
    people: [...staff.rows, ...visitors.rows]
      .sort((a, b) => new Date(b.checkInAt) - new Date(a.checkInAt))
      .slice(0, PEOPLE_SHOWN),
  };
};

const activityRange = (period, now) => {
  if (!ACTIVITY_PERIODS.includes(period))
    throw new AppError("invalid_activity_period", 400);
  if (period !== "thisWeek") return resolvePeriod(period, now);
  const week = moment.tz(now, ACTIVITY_TZ).startOf("isoWeek");
  return { start: week.toDate(), end: week.clone().add(7, "days").toDate() };
};

const visitActivity = async ({ branchId, period, now }) => {
  const { start, end } = activityRange(period, now);
  const match = {
    branchId,
    status: { $in: COUNTED_VISITS },
    checkInAt: { $gte: start, $lt: end },
  };
  const [[totals], reasons] = await Promise.all([
    VisitSession.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          other: {
            $sum: { $cond: [{ $in: ["$personType", OTHER_VISITS] }, 1, 0] },
          },
          all: { $sum: 1 },
          averageMinutes: {
            $avg: {
              $cond: [
                { $ne: ["$checkOutAt", null] },
                {
                  $divide: [
                    { $subtract: ["$checkOutAt", "$checkInAt"] },
                    60000,
                  ],
                },
                null,
              ],
            },
          },
        },
      },
    ]),
    VisitSession.aggregate([
      { $match: { ...match, purposeOfVisit: { $nin: ["", null] } } },
      { $group: { _id: "$purposeOfVisit", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: REASONS_SHOWN },
    ]),
  ]);
  return {
    visitorVisits: (totals?.all ?? 0) - (totals?.other ?? 0),
    contractorProfessionalVisits: totals?.other ?? 0,
    averageVisitMinutes:
      totals?.averageMinutes == null ? null : Math.round(totals.averageMinutes),
    topReasons: reasons.map((row) => ({ reason: row._id, count: row.count })),
  };
};

const requirementRows = (cells, type) => {
  const byName = new Map();
  cells
    .filter((row) => row.type === type && row.cell.expected)
    .forEach(({ name, cell }) => {
      const row = byName.get(name) || {
        name,
        total: 0,
        complete: 0,
        dueSoon: 0,
        pending: 0,
        overdue: 0,
        dueAt: null,
      };
      row.total += 1;
      row[COUNT_FIELD[cell.status] || "pending"] += 1;
      if (!cell.met && cell.dueDate && (!row.dueAt || cell.dueDate < row.dueAt))
        row.dueAt = cell.dueDate;
      byName.set(name, row);
    });
  const share = (count, total) => Math.round((count / total) * 100);
  return [...byName.values()]
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.pending - a.pending ||
        a.name.localeCompare(b.name),
    )
    .map((row) => ({
      ...row,
      complete: share(row.complete, row.total),
      dueSoon: share(row.dueSoon, row.total),
      pending: share(row.pending, row.total),
      overdue: share(row.overdue, row.total),
    }));
};

const meetingRows = async ({
  staff,
  supervisionStandings,
  appraisalStandings,
}) => {
  if (!staff.length) return [];
  const names = await StaffProfile.aggregate([
    { $match: { _id: { $in: staff.map((member) => member._id) } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    { $project: { name: { $ifNull: ["$user.name", ""] } } },
  ]);
  const nameOf = new Map(names.map((row) => [String(row._id), row.name]));
  const rows = [];
  const collect = (type, standings) =>
    standings.forEach((standing, index) =>
      rows.push({
        type,
        staffName: nameOf.get(String(staff[index]._id)) || "",
        status: standing.badge,
        completed: standing.completed,
        expected: standing.required,
        dueAt:
          standing.badge === "overdue"
            ? null
            : standing.upcoming?.scheduledAt || standing.nextDueAt,
      }),
    );
  collect("supervision", supervisionStandings);
  collect("appraisal", appraisalStandings);
  return rows.sort(
    (a, b) =>
      MEETING_ORDER.indexOf(a.status) - MEETING_ORDER.indexOf(b.status) ||
      a.staffName.localeCompare(b.staffName),
  );
};

const getSiteDashboard = async ({
  actor,
  organizationId,
  people,
  period = "thisMonth",
  now = new Date(),
}) => {
  const peopleFilter = parsePeople(people);
  activityRange(period, now);
  const liveBranchId = toObjectId(
    await resolveLiveBranchId({ actor, organizationId }),
  );
  const organization = toObjectId(organizationId);

  const [branch] = await Branch.aggregate([
    { $match: { _id: liveBranchId } },
    { $project: { timezone: 1 } },
  ]);
  const [
    onSite,
    professionals,
    pendingApprovals,
    list,
    feed,
    activity,
    snapshot,
    shifts,
  ] = await Promise.all([
    evacuationService.getOnSiteSummary({
      organizationId,
      branchId: liveBranchId,
    }),
    VisitSession.aggregate([
      {
        $match: {
          branchId: liveBranchId,
          status: VisitSessionStatus.ON_SITE,
          checkOutAt: null,
          personType: ExternalPersonType.PROFESSIONAL,
        },
      },
      { $count: "count" },
    ]),
    VisitSession.aggregate([
      {
        $match: {
          branchId: liveBranchId,
          status: VisitSessionStatus.AWAITING_APPROVAL,
        },
      },
      { $count: "count" },
    ]),
    peopleOnSite({ branchId: liveBranchId, now, people: peopleFilter }),
    listSiteActivity({
      branchId: liveBranchId,
      page: 1,
      limit: ACTIVITY_SHOWN,
      skip: 0,
    }),
    visitActivity({ branchId: liveBranchId, period, now }),
    complianceSnapshot({
      organization,
      branchZones: new Map([[String(liveBranchId), branch?.timezone]]),
      now,
      branchId: liveBranchId,
    }),
    openShifts({
      organization,
      now,
      branchId: liveBranchId,
      include: { openedAt: 1 },
    }),
  ]);

  const professionalCount = professionals[0]?.count ?? 0;
  return {
    summary: {
      visitorsOnSite: onSite.counts.visitors - professionalCount,
      staffOnSite: onSite.counts.staff,
      residentsPresent: onSite.counts.residents,
      pendingApprovals: pendingApprovals[0]?.count ?? 0,
      contractorsOnSite: onSite.counts.contractors,
      professionalsOnSite: professionalCount,
      residentsOutOfHome: null,
    },
    peopleOnSite: list,
    activityFeed: feed.data,
    visitorAndContractorActivity: activity,
    compliance: {
      percentage: snapshot.competency.compliantPercent,
      items: requirementRows(snapshot.detail.cells, "competency"),
    },
    staffTraining: {
      percentage: snapshot.training.compliantPercent,
      items: requirementRows(snapshot.detail.cells, "training"),
    },
    supervisionAppraisal: {
      percentage: snapshot.supervisionAppraisal.compliantPercent,
      items: await meetingRows(snapshot.detail),
    },
    openShifts: shifts.map(({ siteName, ...shift }) => shift),
  };
};

module.exports = { getSiteDashboard };
