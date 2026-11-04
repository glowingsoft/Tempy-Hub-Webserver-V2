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
const { Requirement } = require("@models/Requirement");
const { RequirementAssignment } = require("@models/RequirementAssignment");
const { RequirementRecord } = require("@models/RequirementRecord");
const {
  requirementRows,
  trainingRows,
  meetingRows,
} = require("./complianceRows");
const { cellFromDates } = require("@adminServices/requirements/requirementDates");
const { DEFAULT_TZ, supervisionStanding } = require("@adminServices/supervision/supervisionSchedule");
const { effectiveIntervals } = require("@adminServices/appraisal/cycle");
const { SupervisionRecord } = require("@models/SupervisionRecord");
const { AppraisalRecord } = require("@models/AppraisalRecord");
const {
  AdmissionStatus,
  CareLevel,
  AppraisalKind,
  ComplianceMeetingStatus,
  RequirementType,
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

const latestRecord = (records) =>
  records.reduce((latest, record) => (!latest || record.completedAt > latest.completedAt ? record : latest), null);

const requirementScores = (cells) => {
  const byName = new Map();
  cells.forEach(({ name, cell }) => {
    if (!cell.expected) return;
    const row = byName.get(name) || { done: 0, expected: 0 };
    row.expected += 1;
    if (cell.met) row.done += 1;
    byName.set(name, row);
  });
  const rows = [...byName];
  const done = rows.reduce((sum, [, row]) => sum + row.done, 0);
  const expected = rows.reduce((sum, [, row]) => sum + row.expected, 0);
  return {
    compliantPercent: percentOf(done, expected),
    items: rows
      .map(([name, row]) => ({ name, compliantPercent: percentOf(row.done, row.expected) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

const meetingScores = (standings, now) => {
  const monthEnd = moment.tz(now, TZ).endOf("month");
  const count = (badges) => standings.filter((standing) => badges.includes(standing.badge)).length;
  return {
    required: standings.reduce((sum, standing) => sum + standing.required, 0),
    completed: standings.reduce((sum, standing) => sum + Math.min(standing.completed, standing.required), 0),
    pending: count(["booked", "dueSoon"]),
    overdue: count(["overdue"]),
    dueThisMonth: standings.filter((standing) => standing.badge !== "overdue" && moment(standing.nextDueAt).isSameOrBefore(monthEnd)).length,
  };
};

const complianceSnapshot = async ({ organization, branchZones, now, branchId = null }) => {
  const scope = branchId ? { branchId } : {};
  const [staff, [org], supervisions, appraisals, assignments] = await Promise.all([
    StaffProfile.aggregate([
      { $match: { organizationId: organization, status: StaffProfileStatus.ACTIVE, ...scope } },
      { $project: { branchId: 1, startDate: 1, supervisionIntervalMonths: 1, appraisalIntervalMonths: 1 } },
    ]),
    Organization.aggregate([{ $match: { _id: organization } }, { $project: { settings: 1 } }]),
    SupervisionRecord.aggregate([
      { $match: { organizationId: organization, status: { $ne: ComplianceMeetingStatus.CANCELLED }, ...scope } },
      { $project: { staffId: 1, status: 1, completedAt: 1, scheduledAt: 1 } },
    ]),
    AppraisalRecord.aggregate([
      { $match: { organizationId: organization, status: { $ne: ComplianceMeetingStatus.CANCELLED }, ...scope } },
      { $project: { staffId: 1, status: 1, completedAt: 1, scheduledAt: 1, kind: 1 } },
    ]),
    RequirementAssignment.aggregate([
      { $match: { organizationId: organization, ...scope } },
      { $lookup: { from: Requirement.collection.name, localField: "requirementId", foreignField: "_id", as: "requirement" } },
      { $unwind: "$requirement" },
      { $lookup: { from: RequirementRecord.collection.name, localField: "_id", foreignField: "assignmentId", as: "records" } },
      {
        $project: {
          staffId: 1,
          assignedAt: 1,
          dueDate: 1,
          requirement: { name: 1, type: 1, createdAt: 1, firstCompletionDays: 1, amberDaysOverride: 1 },
          records: { completedAt: 1, expiresAt: 1 },
        },
      },
    ]),
  ]);

  const settings = org?.settings || {};
  const amberDays = settings.amberDays ?? null;
  const active = new Set(staff.map((member) => String(member._id)));
  const cells = assignments
    .filter((row) => active.has(String(row.staffId)))
    .map((row) => ({
      assignmentId: row._id,
      staffId: row.staffId,
      name: row.requirement.name,
      type: row.requirement.type,
      cell: cellFromDates({ assignment: row, latest: latestRecord(row.records), requirement: row.requirement, orgAmberDays: amberDays, today: now }),
    }));

  const standingOf = (member, intervalMonths, meetings) =>
    supervisionStanding({
      startDate: member.startDate,
      intervalMonths,
      meetings: meetings.filter((row) => String(row.staffId) === String(member._id)),
      timezone: branchZones.get(String(member.branchId)) || DEFAULT_TZ,
      checkDate: now,
    });
  const countsAsAppraisal = (row) =>
    row.status === ComplianceMeetingStatus.SCHEDULED ||
    (row.status === ComplianceMeetingStatus.COMPLETED && row.kind !== AppraisalKind.OTHER);
  const appraisalMeetings = appraisals.filter(countsAsAppraisal);
  const supervisionStandings = staff.map((member) =>
    standingOf(member, effectiveIntervals(member, settings).supervisionMonths, supervisions),
  );
  const appraisalStandings = staff.map((member) =>
    standingOf(member, effectiveIntervals(member, settings).appraisalMonths, appraisalMeetings),
  );

  const supervision = meetingScores(supervisionStandings, now);
  const appraisal = meetingScores(appraisalStandings, now);
  return {
    detail: { staff, cells, supervisionStandings, appraisalStandings },
    competency: requirementScores(cells.filter((cell) => cell.type === RequirementType.COMPETENCY)),
    training: requirementScores(cells.filter((cell) => cell.type === RequirementType.TRAINING)),
    supervisionAppraisal: {
      compliantPercent: percentOf(supervision.completed + appraisal.completed, supervision.required + appraisal.required),
      supervisions: { pending: supervision.pending, overdue: supervision.overdue },
      appraisals: { dueThisMonth: appraisal.dueThisMonth, overdue: appraisal.overdue },
    },
  };
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

const openShifts = ({ organization, now, branchId = null, include = {} }) =>
  Shift.aggregate([
    { $match: { organizationId: organization, status: ShiftStatus.OPEN, startsAt: { $gt: now }, ...(branchId ? { branchId } : {}) } },
    { $sort: { startsAt: 1 } },
    { $limit: OPEN_SHIFTS_SHOWN },
    { $lookup: { from: Branch.collection.name, localField: "branchId", foreignField: "_id", as: "branch" } },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, siteName: { $ifNull: ["$branch.name", ""] }, startsAt: 1, endsAt: 1, urgentCover: { $ifNull: ["$urgentCover", false] }, ...include } },
  ]);

const getOwnerDashboard = async ({ organizationId, now = new Date() }) => {
  const organization = toObjectId(organizationId);
  const own = { organizationId: organization };
  const branches = await Branch.aggregate([
    { $match: own },
    { $project: { timezone: 1 } },
  ]);
  const branchIds = branches.map((branch) => branch._id);
  const branchZones = new Map(branches.map((branch) => [String(branch._id), branch.timezone]));
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
    standing,
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
    complianceSnapshot({ organization, branchZones, now }),
    workforceUtilisation({ organization, branchIds, now }),
    openShifts({ organization, now }),
    getWorkforcePeriod(own, resolvePeriod("thisMonth", now)),
  ]);

  const departments = await staffByDepartment({ organization, totalStaff });

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
      compliance: standing.competency.compliantPercent,
      training: standing.training.compliantPercent,
      retention: Math.round(retention.retentionRate),
      utilization: utilisation.utilization,
      satisfaction: null,
    },
    evacuationRisk: risk,
    activeModules: modules,
    fireDrills: drills,
    compliance: {
      percentage: standing.competency.compliantPercent,
      items: requirementRows(standing.detail.cells, "competency"),
    },
    staffTraining: {
      percentage: standing.training.compliantPercent,
      items: await trainingRows(standing.detail),
    },
    supervisionAppraisal: {
      percentage: standing.supervisionAppraisal.compliantPercent,
      items: await meetingRows(standing.detail),
    },
    openShifts: shifts,
  };
};

module.exports = { getOwnerDashboard, complianceSnapshot, openShifts };
