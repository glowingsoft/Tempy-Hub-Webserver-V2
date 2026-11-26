const { randomUUID } = require("node:crypto");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { AppError } = require("@services/_errors/AppError");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { ExternalPerson } = require("@models/ExternalPerson");
const { VisitSession } = require("@models/VisitSession");
const { Resident } = require("@models/Resident");
const { Department } = require("@models/Department");
const { generateMeta } = require("@utils/responseUtil");
const { renderCompliancePdf } = require("./compliancePdf");
const { AttendanceDay } = require("@models/AttendanceDay");
const {
  AdmissionStatus,
  ExternalPersonType,
  MembershipRole,
  PresenceStatus,
  VisitSessionStatus,
} = require("@models/domainEnums");
const moment = require("moment-timezone");
const {
  requirementRows,
  trainingRows,
  meetingRows,
} = require("./complianceRows");
const {
  resolvePeriod,
  getWorkforcePeriod,
} = require("@adminServices/statistics/statisticsService");
const {
  resolveLiveBranchId,
  loadDepartments,
} = require("@adminServices/siteLive/siteLiveService");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const {
  listSiteActivity,
} = require("@adminServices/siteLive/siteActivityQuery");
const { complianceSnapshot, openShifts } = require("./ownerDashboardService");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const {
  actorStanding,
  resolveSubordinateStaffIds,
} = require("@adminServices/staff/staffAccess");

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
      items: await trainingRows(snapshot.detail),
    },
    supervisionAppraisal: {
      percentage: snapshot.supervisionAppraisal.compliantPercent,
      items: await meetingRows(snapshot.detail),
    },
    openShifts: shifts.map(({ siteName, ...shift }) => shift),
  };
};

const RETENTION_MONTHS = 12;

const hoursAndMinutes = (minutes) =>
  `${Math.floor((minutes ?? 0) / 60)} hr ${(minutes ?? 0) % 60} min`;

const getSiteStatistics = async ({
  actor,
  organizationId,
  branchId,
  period = "thisMonth",
  departmentId,
  now = new Date(),
}) => {
  const range = activityRange(period, now);
  const siteId = toObjectId(
    await resolveLiveBranchId({ actor, organizationId, branchId }),
  );
  const departments = await loadDepartments(organizationId, [siteId]);
  if (
    departmentId &&
    !departments.some(
      (department) => String(department._id) === String(departmentId),
    )
  )
    throw new AppError("invalid_department_id", 400);

  const staffScope = {
    organizationId: toObjectId(organizationId),
    branchId: siteId,
    ...(departmentId ? { departmentIds: toObjectId(departmentId) } : {}),
  };
  const [activity, retention, movement] = await Promise.all([
    visitActivity({ branchId: siteId, period, now }),
    getWorkforcePeriod(staffScope, {
      start: moment.utc(now).subtract(RETENTION_MONTHS, "months").toDate(),
      end: now,
    }),
    getWorkforcePeriod(staffScope, range),
  ]);

  const visits = activity.visitorVisits + activity.contractorProfessionalVisits;
  const [top] = activity.topReasons;
  return {
    period,
    visitors: {
      visitors: activity.visitorVisits,
      contractors: activity.contractorProfessionalVisits,
      mostCommonReason: top
        ? {
            reason: top.reason,
            percent: Math.round((top.count / visits) * 100),
          }
        : null,
      averageVisit: hoursAndMinutes(activity.averageVisitMinutes),
    },
    staff: {
      retentionRate: Math.round(retention.retentionRate),
      newStarters: movement.newStarters,
      leavers: movement.leavers,
      departments,
    },
  };
};

const percentOf = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

const meetingPercent = (standings) =>
  percentOf(
    standings.reduce(
      (sum, row) => sum + Math.min(row.completed, row.required),
      0,
    ),
    standings.reduce((sum, row) => sum + row.required, 0),
  );

const byPercentThenName = (a, b) =>
  (b.percent ?? -1) - (a.percent ?? -1) || a.name.localeCompare(b.name);

const staffDetails = async (staff) => {
  const departmentIds = [
    ...new Set(
      staff.flatMap((member) => (member.departmentIds || []).map(String)),
    ),
  ].map(toObjectId);
  const [people, departments] = await Promise.all([
    StaffProfile.aggregate([
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
      {
        $project: {
          name: { $ifNull: ["$user.name", ""] },
          photoUrl: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ["$photoUrl", ""] } }, 0] },
              "$photoUrl",
              { $ifNull: ["$user.profileIcon", ""] },
            ],
          },
        },
      },
    ]),
    departmentIds.length
      ? Department.aggregate([
          { $match: { _id: { $in: departmentIds } } },
          { $project: { name: 1 } },
        ])
      : [],
  ]);
  return {
    people: new Map(people.map((row) => [String(row._id), row])),
    departments: new Map(departments.map((row) => [String(row._id), row.name])),
  };
};

const cycleProgress = ({ startDate, nextDueAt, now, timezone }) => {
  const start = moment.tz(startDate, timezone);
  const monthsSince = Math.max(
    0,
    moment.tz(now, timezone).diff(start, "months"),
  );
  const cycleStart = start
    .clone()
    .add(Math.floor(monthsSince / 12) * 12, "months");
  return {
    cycleMonth: (monthsSince % 12) + 1,
    dueByMonth: Math.round(
      moment.tz(nextDueAt, timezone).diff(cycleStart, "months", true),
    ),
  };
};

const buildSiteCompliance = async ({
  actor,
  organizationId,
  branchId,
  now = new Date(),
}) => {
  const siteId = toObjectId(
    await resolveLiveBranchId({ actor, organizationId, branchId }),
  );
  const [branch] = await Branch.aggregate([
    { $match: { _id: siteId } },
    { $project: { name: 1, timezone: 1 } },
  ]);
  const timezone = branch?.timezone || ACTIVITY_TZ;
  // A line manager sees only their direct reports on their own site.
  const standing = await actorStanding(actor, organizationId);
  const staffIds =
    standing.role === MembershipRole.LINE_MANAGER
      ? await resolveSubordinateStaffIds({ userId: actor._id, organizationId })
      : null;
  const snapshot = await complianceSnapshot({
    organization: toObjectId(organizationId),
    branchZones: new Map([[String(siteId), branch?.timezone]]),
    now,
    branchId: siteId,
    staffIds,
  });
  const { staff, supervisionStandings, appraisalStandings } = snapshot.detail;
  const { people, departments } = await staffDetails(staff);

  const byDepartment = new Map();
  staff.forEach((member, index) => {
    const { completed, required } = supervisionStandings[index];
    (member.departmentIds || []).forEach((id) => {
      const row = byDepartment.get(String(id)) || { done: 0, expected: 0 };
      row.done += Math.min(completed, required);
      row.expected += required;
      byDepartment.set(String(id), row);
    });
  });

  const rows = staff
    .map((member, index) => {
      const standing = supervisionStandings[index];
      const person = people.get(String(member._id));
      return {
        staffId: member._id,
        name: person?.name || "",
        photoUrl: person?.photoUrl || "",
        intervalMonths: standing.intervalMonths,
        customInterval: Boolean(member.supervisionIntervalMonths),
        percent: standing.score ?? 0,
        completedThisCycle: standing.completedThisCycle,
        expectedThisCycle: standing.expectedThisCycle,
        ...cycleProgress({
          startDate: member.startDate,
          nextDueAt: standing.nextDueAt,
          now,
          timezone,
        }),
      };
    })
    .sort(
      (a, b) =>
        (a.percent ?? 101) - (b.percent ?? 101) || a.name.localeCompare(b.name),
    );

  return {
    siteName: branch?.name || "",
    scores: {
      supervision: meetingPercent(supervisionStandings),
      appraisal: meetingPercent(appraisalStandings),
      competency: snapshot.competency.compliantPercent,
      training: snapshot.training.compliantPercent,
    },
    supervisionByDepartment: [...byDepartment]
      .map(([id, row]) => ({
        name: departments.get(id) || "",
        percent: percentOf(row.done, row.expected),
      }))
      .filter((row) => row.name)
      .sort(byPercentThenName)
      .map(({ name, percent }) => ({ department: name, percent })),
    staff: rows,
  };
};

const getSiteCompliance = async ({ page, limit, skip, ...scope }) => {
  const { siteName, staff, ...report } = await buildSiteCompliance(scope);
  return {
    data: { ...report, staff: staff.slice(skip, skip + limit) },
    meta: generateMeta(page, limit, staff.length),
  };
};

const SCORE_LABELS = [
  ["supervision", "Supervision"],
  ["appraisal", "Appraisal"],
  ["competency", "Competency"],
  ["training", "Training"],
];
const STAFF_HEADERS = [
  "Name",
  "Supervision every (months)",
  "Custom interval",
  "Supervision %",
  "Done this cycle",
  "Due this cycle",
  "Month of cycle",
  "Due by month",
];

const percentText = (value) => (value == null ? "" : `${value}%`);

const staffCells = (row) => [
  row.name,
  row.intervalMonths,
  row.customInterval ? "Yes" : "No",
  percentText(row.percent),
  row.completedThisCycle,
  row.expectedThisCycle,
  row.cycleMonth,
  row.dueByMonth,
];

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const complianceCsv = ({ scores, supervisionByDepartment, staff }) => {
  const line = (cells) => cells.map(csvCell).join(",");
  return `\uFEFF${[
    line(["Score", "Percent"]),
    ...SCORE_LABELS.map(([key, label]) =>
      line([label, percentText(scores[key])]),
    ),
    "",
    line(["Department", "Supervision %"]),
    ...supervisionByDepartment.map((row) =>
      line([row.department, percentText(row.percent)]),
    ),
    "",
    line(STAFF_HEADERS),
    ...staff.map((row) => line(staffCells(row))),
  ].join("\r\n")}`;
};

const exportSiteCompliance = async ({ format, ...scope }) => {
  const responseFormat = String(format ?? "url").trim().toLowerCase();
  if (responseFormat !== "url") {
    throw new AppError("invalid_export_format", 400, { validFormats: "url" });
  }

  const report = await buildSiteCompliance(scope);
  const day = moment.utc(scope.now ?? new Date()).format("YYYY-MM-DD");
  const [csvBody, pdfBody] = await Promise.all([
    Promise.resolve(Buffer.from(complianceCsv(report), "utf8")),
    renderCompliancePdf({ report, day }),
  ]);

  const uploadAndSign = async ({ format, body, contentType }) => {
    const fileName = `compliance-${day}.${format}`;
    const key = `compliance-exports/${randomUUID()}.${format}`;
    await uploadAwsService.putObject({ key, body, contentType });
    const { token, expiresAt } = uploadAwsService.createShortDownloadToken({
      key,
      filename: fileName,
      contentType,
    });
    return { token, expiresAt, fileName };
  };

  const [csv, pdf] = await Promise.all([
    uploadAndSign({
      format: "csv",
      body: csvBody,
      contentType: "text/csv; charset=utf-8",
    }),
    uploadAndSign({ format: "pdf", body: pdfBody, contentType: "application/pdf" }),
  ]);
  return {
    pdfToken: pdf.token,
    pdfFileName: pdf.fileName,
    pdfExpiresAt: pdf.expiresAt,
    csvToken: csv.token,
    csvFileName: csv.fileName,
    csvExpiresAt: csv.expiresAt,
  };
};

module.exports = {
  getSiteDashboard,
  getSiteStatistics,
  getSiteCompliance,
  exportSiteCompliance,
};
