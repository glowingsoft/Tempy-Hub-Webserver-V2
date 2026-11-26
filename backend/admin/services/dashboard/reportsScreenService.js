const moment = require("moment-timezone");
const { ModuleSlug } = require("@models/domainEnums");
const attendanceService = require("@adminServices/attendance/attendanceService");
const visitSessionService = require("@adminServices/visitors/visitSessionService");

const DAY = "YYYY-MM-DD";

const moduleIsActive = (organization, moduleSlug, isPlatformAdmin) =>
  isPlatformAdmin ||
  (organization?.moduleAccess || []).some(
    (module) =>
      module.moduleSlug === moduleSlug &&
      module.enabled &&
      (!module.expiresAt || new Date(module.expiresAt) > new Date()),
  );

const periodLabel = (from, to) => {
  const start = moment.utc(from, DAY);
  const end = moment.utc(to, DAY);
  const first = start.isSame(end, "month") ? start.format("DD") : start.format("DD MMM");
  return `${first} - ${end.format("DD MMM")}`;
};

const attendanceCards = async ({ scope, now }) => {
  const oneRow = { ...scope, page: 1, limit: 1, skip: 0 };
  const month = await attendanceService.lateCheckInsReport(oneRow);
  const today = moment(now).tz(month.timezone);
  const weekFrom = today.clone().startOf("isoWeek").format(DAY);
  const to = today.format(DAY);
  const [week, sickness] = await Promise.all([
    attendanceService.lateCheckInsReport({ ...oneRow, from: weekFrom, to }),
    attendanceService.sicknessRateReport(oneRow),
  ]);

  const total = week.kpis.staff;
  const late = week.kpis.late;
  const onTimePercent = total ? Math.round(((total - late) / total) * 100) : null;
  const rate = sickness.kpis.sicknessRate;

  return {
    attendance: {
      title: "Attendance",
      subtitle:
        onTimePercent === null
          ? "This week - No check-ins"
          : `This week - ${onTimePercent}% on time`,
      from: weekFrom,
      to,
      checkIns: total,
      late,
      onTimePercent,
    },
    staffHours: {
      title: "Staff Hours Summary",
      subtitle: `Period: ${periodLabel(month.from, to)}`,
      from: month.from,
      to,
    },
    sicknessRate: {
      title: "Sickness Rate",
      subtitle: `${rate === null ? "No data" : `${rate}%`} - Tap For People`,
      from: sickness.from,
      to: sickness.to,
      rate,
      staffAffected: sickness.kpis.staffAffected,
    },
    lateCheckIns: {
      title: "Late Check-Ins",
      subtitle: `${month.kpis.late} this month - Tap for people`,
      from: month.from,
      to: month.to,
      count: month.kpis.late,
    },
  };
};

const visitorsToday = async ({ scope, now, page, limit, skip }) => {
  const month = await visitSessionService.visitorCheckInsReport({
    ...scope,
    page: 1,
    limit: 1,
    skip: 0,
  });
  const day = moment(now).tz(month.timezone).format(DAY);
  const report = await visitSessionService.visitorCheckInsReport({
    ...scope,
    from: day,
    to: day,
    page,
    limit,
    skip,
  });
  const total = report.meta?.totalRecords ?? 0;

  return {
    card: {
      title: "Visitor Check-Ins",
      subtitle: `${total} today`,
      from: day,
      to: day,
      count: total,
    },
    list: {
      title: "Visitor Check-In - Today",
      items: report.rows.map((row) => ({
        _id: row._id,
        name: row.person?.name || "",
        photoUrl: row.person?.photoUrl || "",
        personType: row.personType,
        checkInAt: row.checkInAt,
        time: row.checkInAt ? moment(row.checkInAt).tz(month.timezone).format("HH:mm") : "",
        reason: row.purposeOfVisit || "",
        hostName: row.hostName || "",
        status: row.status,
      })),
      meta: report.meta,
    },
  };
};

const getReportsScreen = async ({
  actor,
  organizationId,
  organization,
  isPlatformAdmin,
  branchId,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const scope = { actor, organizationId, branchId };
  const [attendance, visitors] = await Promise.all([
    moduleIsActive(organization, ModuleSlug.SIGN_IN_ATTENDANCE, isPlatformAdmin)
      ? attendanceCards({ scope, now })
      : null,
    moduleIsActive(organization, ModuleSlug.FIRE_DRILL_EVACUATION, isPlatformAdmin)
      ? visitorsToday({ scope, now, page, limit, skip })
      : null,
  ]);

  return {
    attendance: attendance?.attendance ?? null,
    visitorCheckIns: visitors?.card ?? null,
    staffHours: attendance?.staffHours ?? null,
    sicknessRate: attendance?.sicknessRate ?? null,
    lateCheckIns: attendance?.lateCheckIns ?? null,
    visitorCheckInsToday: visitors?.list ?? null,
  };
};

module.exports = { getReportsScreen };
