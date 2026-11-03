const moment = require("moment-timezone");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { ModuleDefinition } = require("@models/ModuleDefinition");
const { StaffProfile } = require("@models/StaffProfile");
const { Resident } = require("@models/Resident");
const { ExternalPerson } = require("@models/ExternalPerson");
const { VisitSession } = require("@models/VisitSession");
const { AttendanceDay } = require("@models/AttendanceDay");
const { Shift } = require("@models/Shift");
const { LeaveRequest } = require("@models/LeaveRequest");
const { Department } = require("@models/Department");
const { PeepRecord } = require("@models/PeepRecord");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { CompetencyRecord } = require("@models/CompetencyRecord");
const { SupervisionRecord } = require("@models/SupervisionRecord");
const { AppraisalRecord } = require("@models/AppraisalRecord");
const {
  AdmissionStatus,
  CareLevel,
  ComplianceRecordStatus,
  EvacuationStatus,
  EvacuationType,
  ExternalPersonType,
  LeaveRequestStatus,
  LeaveType,
  ModuleSlug,
  ShiftStatus,
  StaffProfileStatus,
  VisitSessionStatus,
} = require("@models/domainEnums");
const {
  getWorkforcePeriod,
  resolvePeriod,
} = require("@adminServices/statistics/statisticsService");

const TZ = "Europe/London";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_SHIFTS_SHOWN = 5;
const DRILL_OVERDUE_DAYS = 90;
const LEAVE_GROUPS = [
  { key: "annual", label: "Annual leave", types: [LeaveType.ANNUAL] },
  { key: "sick", label: "Sick leave", types: [LeaveType.SICK] },
  { key: "unpaid", label: "Unpaid leave", types: [LeaveType.UNPAID] },
];

const percentOf = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;
const localDay = (date) => moment.tz(date, TZ).format("YYYY-MM-DD");
const utcDay = (date) => new Date(date).toISOString().slice(0, 10);

const countOf = async (model, match) => {
  const [row] = await model.aggregate([{ $match: match }, { $count: "count" }]);
  return row?.count ?? 0;
};

const humanise = (slug) =>
  slug
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());

const attendanceWeek = async ({ organization, branchIds, now }) => {
  const start = moment.tz(now, TZ).startOf("isoWeek");
  const days = DAYS.map((label, index) => {
    const day = start.clone().add(index, "days");
    return { label, date: day.format("YYYY-MM-DD") };
  });
  const end = start.clone().add(7, "days");
  const [shifts, attended] = await Promise.all([
    Shift.aggregate([
      {
        $match: {
          organizationId: organization,
          status: ShiftStatus.SCHEDULED,
          staffId: { $ne: null },
          startsAt: { $gte: start.toDate(), $lt: end.toDate() },
        },
      },
      { $project: { _id: 0, staffId: 1, startsAt: 1 } },
    ]),
    AttendanceDay.aggregate([
      {
        $match: {
          branchId: { $in: branchIds },
          workDate: {
            $gte: new Date(`${days[0].date}T00:00:00Z`),
            $lt: new Date(`${end.format("YYYY-MM-DD")}T00:00:00Z`),
          },
        },
      },
      { $project: { _id: 0, staffId: 1, workDate: 1 } },
    ]),
  ]);

  const scheduled = new Map();
  shifts
    .filter((shift) => new Date(shift.startsAt) <= now)
    .forEach((shift) => {
      const key = localDay(shift.startsAt);
      scheduled.set(
        key,
        new Set([...(scheduled.get(key) || []), String(shift.staffId)]),
      );
    });
  const present = new Map();
  attended.forEach((row) => {
    const key = utcDay(row.workDate);
    present.set(
      key,
      new Set([...(present.get(key) || []), String(row.staffId)]),
    );
  });

  const today = localDay(now);
  return days.map(({ label, date }) => {
    if (date > today) return { day: label, present: null, absent: null };
    const here = present.get(date) || new Set();
    const expected = scheduled.get(date) || new Set();
    return {
      day: label,
      present: here.size,
      absent: [...expected].filter((id) => !here.has(id)).length,
    };
  });
};

const leaveBreakdown = async ({ organization, now }) => {
  const year = moment.tz(now, TZ).year();
  const rows = await LeaveRequest.aggregate([
    {
      $match: {
        organizationId: organization,
        status: {
          $in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.CLOSED],
        },
        startDate: {
          $gte: new Date(Date.UTC(year, 0, 1)),
          $lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    },
    { $group: { _id: "$leaveType", days: { $sum: "$totalDays" } } },
  ]);
  const daysOf = (types) =>
    rows
      .filter((row) => types.includes(row._id))
      .reduce((sum, row) => sum + row.days, 0);
  const named = LEAVE_GROUPS.flatMap((group) => group.types);
  const slices = [
    ...LEAVE_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      days: daysOf(group.types),
    })),
    {
      key: "other",
      label: "Other",
      days: rows
        .filter((row) => !named.includes(row._id))
        .reduce((sum, row) => sum + row.days, 0),
    },
  ];
  const total = slices.reduce((sum, slice) => sum + slice.days, 0);
  return slices.map(({ label, days }) => ({
    label,
    percent: total ? Math.round((days / total) * 1000) / 10 : 0,
  }));
};

const staffByDepartment = async ({ organization, totalStaff }) => {
  const [rows, departments] = await Promise.all([
    StaffProfile.aggregate([
      {
        $match: {
          organizationId: organization,
          status: StaffProfileStatus.ACTIVE,
        },
      },
      { $unwind: { path: "$departmentIds", preserveNullAndEmptyArrays: true } },
      { $group: { _id: "$departmentIds", count: { $sum: 1 } } },
    ]),
    Department.aggregate([
      { $match: { organizationId: organization } },
      { $project: { name: 1 } },
    ]),
  ]);
  const nameOf = new Map(
    departments.map((department) => [String(department._id), department.name]),
  );
  const counts = new Map();
  rows.forEach((row) => {
    const name = row._id
      ? nameOf.get(String(row._id)) || "Unassigned"
      : "Unassigned";
    counts.set(name, (counts.get(name) || 0) + row.count);
  });
  return {
    totalStaff,
    departments: [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
};

const evacuationRisk = async ({ organization }) => {
  const admittedResidents = await countOf(Resident, {
    organizationId: organization,
    admissionStatus: AdmissionStatus.ADMITTED,
  });
  const rows = await PeepRecord.aggregate([
    { $match: { organizationId: organization } },
    {
      $lookup: {
        from: Resident.collection.name,
        localField: "residentId",
        foreignField: "_id",
        as: "resident",
      },
    },
    { $unwind: "$resident" },
    { $match: { "resident.admissionStatus": AdmissionStatus.ADMITTED } },
    { $group: { _id: "$peepLevel", count: { $sum: 1 } } },
  ]);
  const at = (level) => rows.find((row) => row._id === level)?.count ?? 0;
  const levels = {
    high: at(CareLevel.HIGH),
    medium: at(CareLevel.MEDIUM),
    low: at(CareLevel.LOW),
  };
  return {
    ...levels,
    notSet: Math.max(
      0,
      admittedResidents - levels.high - levels.medium - levels.low,
    ),
  };
};

const activeModules = async ({ organization, now }) => {
  const [[row], definitions] = await Promise.all([
    Organization.aggregate([
      { $match: { _id: organization } },
      { $project: { moduleAccess: 1 } },
    ]),
    ModuleDefinition.aggregate([
      { $match: { active: true } },
      { $sort: { slug: 1 } },
      { $project: { _id: 0, slug: 1, name: 1 } },
    ]),
  ]);
  const entitled = new Set(
    (row?.moduleAccess || [])
      .filter(
        (module) =>
          module.enabled &&
          (!module.expiresAt || new Date(module.expiresAt) > now),
      )
      .map((module) => module.moduleSlug),
  );
  const catalogue = definitions.length
    ? definitions
    : Object.values(ModuleSlug).map((slug) => ({ slug, name: humanise(slug) }));
  const modules = catalogue.map(({ slug, name }) => ({
    slug,
    name,
    active: entitled.has(slug),
  }));
  return {
    active: modules.filter((module) => module.active).length,
    total: modules.length,
    modules,
  };
};

const fireDrills = async ({ branchIds, now }) => {
  const quarterStart = new Date(
    Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
  );
  const quarterEnd = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      Math.floor(now.getUTCMonth() / 3) * 3 + 3,
      1,
    ),
  );
  const rows = await EvacuationEvent.aggregate([
    {
      $match: {
        branchId: { $in: branchIds },
        type: EvacuationType.MOCK,
        status: EvacuationStatus.CLOSED,
      },
    },
    {
      $group: {
        _id: "$branchId",
        last: { $max: "$startedAt" },
        thisQuarter: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$startedAt", quarterStart] },
                  { $lt: ["$startedAt", quarterEnd] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const cutoff = new Date(now.getTime() - DRILL_OVERDUE_DAYS * DAY_MS);
  const lastBySite = new Map(rows.map((row) => [String(row._id), row.last]));
  return {
    completed: rows.reduce((sum, row) => sum + row.thisQuarter, 0),
    overdueSites: branchIds.filter(
      (id) =>
        !lastBySite.get(String(id)) ||
        new Date(lastBySite.get(String(id))) < cutoff,
    ).length,
  };
};

const complianceOf = async (model, branchIds, now) => {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const { DUE, OVERDUE, COMPLETED, CANCELLED } = ComplianceRecordStatus;
  const [row] = await model.aggregate([
    { $match: { branchId: { $in: branchIds }, status: { $ne: CANCELLED } } },
    {
      $group: {
        _id: null,
        completed: { $sum: { $cond: [{ $eq: ["$status", COMPLETED] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$status", OVERDUE] },
                  {
                    $and: [{ $eq: ["$status", DUE] }, { $lt: ["$dueAt", now] }],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        pending: {
          $sum: { $cond: [{ $in: ["$status", [DUE, OVERDUE]] }, 1, 0] },
        },
        dueThisMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", DUE] },
                  { $gte: ["$dueAt", monthStart] },
                  { $lt: ["$dueAt", monthEnd] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const {
    completed = 0,
    overdue = 0,
    pending = 0,
    dueThisMonth = 0,
  } = row || {};
  return { completed, overdue, pending, dueThisMonth };
};

const workforceUtilisation = async ({ organization, branchIds, now }) => {
  const monthStart = moment.tz(now, TZ).startOf("month");
  const monthEnd = monthStart.clone().add(1, "month");
  const [shifts, attended] = await Promise.all([
    Shift.aggregate([
      {
        $match: {
          organizationId: organization,
          startsAt: { $gte: monthStart.toDate(), $lt: monthEnd.toDate() },
          status: {
            $in: [
              ShiftStatus.SCHEDULED,
              ShiftStatus.COMPLETED,
              ShiftStatus.OPEN,
            ],
          },
        },
      },
      { $project: { _id: 0, staffId: 1, startsAt: 1, status: 1 } },
    ]),
    AttendanceDay.aggregate([
      {
        $match: {
          branchId: { $in: branchIds },
          workDate: {
            $gte: new Date(`${monthStart.format("YYYY-MM-DD")}T00:00:00Z`),
            $lt: new Date(`${monthEnd.format("YYYY-MM-DD")}T00:00:00Z`),
          },
        },
      },
      { $project: { _id: 0, staffId: 1, workDate: 1 } },
    ]),
  ]);
  const filled = shifts.filter(
    (shift) => shift.status !== ShiftStatus.OPEN && shift.staffId,
  );
  const expected = new Set(
    filled
      .filter((shift) => new Date(shift.startsAt) <= now)
      .map((shift) => `${shift.staffId}:${localDay(shift.startsAt)}`),
  );
  const came = new Set(
    attended.map((row) => `${row.staffId}:${utcDay(row.workDate)}`),
  );
  return {
    attendance: percentOf(
      [...expected].filter((key) => came.has(key)).length,
      expected.size,
    ),
    utilization: percentOf(filled.length, shifts.length),
  };
};

const openShifts = ({ organization, now }) =>
  Shift.aggregate([
    { $match: { organizationId: organization, status: ShiftStatus.OPEN, startsAt: { $gt: now } } },
    { $sort: { startsAt: 1 } },
    { $limit: OPEN_SHIFTS_SHOWN },
    { $lookup: { from: Branch.collection.name, localField: "branchId", foreignField: "_id", as: "branch" } },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, siteName: { $ifNull: ["$branch.name", ""] }, startsAt: 1, endsAt: 1, urgentCover: { $ifNull: ["$urgentCover", false] } } },
  ]);

const getOwnerDashboard = async ({ organizationId, now = new Date() }) => {
  const organization = toObjectId(organizationId);
  const own = { organizationId: organization };
  const branches = await Branch.aggregate([
    { $match: own },
    { $project: { _id: 1 } },
  ]);
  const branchIds = branches.map((branch) => branch._id);
  const today = moment.tz(now, TZ);

  const [
    totalStaff,
    totalResidents,
    todayVisitors,
    contractors,
    professionals,
    week,
    leave,
    risk,
    modules,
    drills,
    training,
    supervisions,
    appraisals,
    utilisation,
    shifts,
    retention,
  ] = await Promise.all([
    countOf(StaffProfile, { ...own, status: StaffProfileStatus.ACTIVE }),
    countOf(Resident, { ...own, admissionStatus: AdmissionStatus.ADMITTED }),
    countOf(VisitSession, {
      branchId: { $in: branchIds },
      type: ExternalPersonType.VISITOR,
      status: {
        $in: [VisitSessionStatus.ON_SITE, VisitSessionStatus.CHECKED_OUT],
      },
      checkInAt: {
        $gte: today.clone().startOf("day").toDate(),
        $lt: today.clone().endOf("day").toDate(),
      },
    }),
    countOf(ExternalPerson, {
      branchId: { $in: branchIds },
      type: ExternalPersonType.CONTRACTOR,
    }),
    countOf(ExternalPerson, {
      branchId: { $in: branchIds },
      type: ExternalPersonType.PROFESSIONAL,
    }),
    attendanceWeek({ organization, branchIds, now }),
    leaveBreakdown({ organization, now }),
    evacuationRisk({ organization }),
    activeModules({ organization, now }),
    fireDrills({ branchIds, now }),
    complianceOf(CompetencyRecord, branchIds, now),
    complianceOf(SupervisionRecord, branchIds, now),
    complianceOf(AppraisalRecord, branchIds, now),
    workforceUtilisation({ organization, branchIds, now }),
    openShifts({ organization, now }),
    getWorkforcePeriod(own, resolvePeriod("thisMonth", now)),
  ]);

  const departments = await staffByDepartment({ organization, totalStaff });
  const trainingPercent = percentOf(
    training.completed,
    training.completed + training.overdue,
  );
  const reviewDone = supervisions.completed + appraisals.completed;
  const reviewLate = supervisions.overdue + appraisals.overdue;

  return {
    summary: {
      totalStaff,
      totalResidents,
      todayVisitors,
      totalContractors: contractors,
      totalProfessionals: professionals,
    },
    attendance: week,
    leaveBreakdown: leave,
    staffByDepartment: departments,
    workforceOverview: {
      attendance: utilisation.attendance,
      compliance: null,
      training: trainingPercent,
      retention: Math.round(retention.retentionRate),
      utilization: utilisation.utilization,
      satisfaction: null,
    },
    evacuationRisk: risk,
    activeModules: modules,
    fireDrills: drills,
    compliance: { compliantPercent: null, items: [] },
    staffTraining: { compliantPercent: trainingPercent, items: [] },
    supervisionAppraisal: {
      compliantPercent: percentOf(reviewDone, reviewDone + reviewLate),
      supervisions: {
        pending: supervisions.pending,
        overdue: supervisions.overdue,
      },
      appraisals: {
        dueThisMonth: appraisals.dueThisMonth,
        overdue: appraisals.overdue,
      },
      items: [],
    },
    openShifts: shifts,
  };
};

module.exports = { getOwnerDashboard };
