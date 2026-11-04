const moment = require("moment-timezone");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { AppError } = require("@services/_errors/AppError");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { AttendanceDay } = require("@models/AttendanceDay");
const { LeaveRequest } = require("@models/LeaveRequest");
const { AttendanceChangeRequest } = require("@models/AttendanceChangeRequest");
const { Document } = require("@models/Document");
const { DocumentSignature } = require("@models/DocumentSignature");
const {
  ChangeRequestStatus,
  DocumentAudience,
  LeaveRequestStatus,
  PresenceStatus,
  RequirementCellStatus,
  RequirementType,
  StaffProfileStatus,
} = require("@models/domainEnums");
const {
  getNotifications,
} = require("../../../commonModules/services/notifications/notificationService");
const {
  listMyShifts,
  listOpenShifts,
} = require("@adminServices/rota/shiftService");
const {
  myRequirementAssignments,
} = require("@adminServices/requirements/requirementService");
const { myCompliance } = require("@adminServices/staff/staffComplianceService");

const DEFAULT_TZ = "Europe/London";
const DAY_FORMAT = "YYYY-MM-DD";
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const COMMUNICATION_SHOWN = 5;
const OPEN_SHIFTS_SHOWN = 5;
const MEETING_BADGES = {
  overdue: "overdue",
  dueSoon: "dueSoon",
  booked: "booked",
};
const REQUIREMENT_STATUS = {
  [RequirementCellStatus.EXPIRED]: "overdue",
  [RequirementCellStatus.DUE_SOON]: "dueSoon",
  [RequirementCellStatus.IN_PROGRESS]: "pending",
  [RequirementCellStatus.VALID]: "valid",
};
const NEEDS_ACTION = new Set(["overdue", "dueSoon", "pending"]);
const URGENCY = ["overdue", "dueSoon", "pending", "valid"];
const byUrgency = (a, b) =>
  URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status);

const hours = (minutes) => Math.round((minutes / 60) * 100) / 100;

const weekDays = (anchor, tz) => {
  const start = moment.tz(anchor, tz).startOf("isoWeek");
  return DAY_LABELS.map((day, index) => ({
    day,
    date: start.clone().add(index, "days").format(DAY_FORMAT),
  }));
};

const parseWeekStart = (value, tz, now) => {
  if (value == null || value === "") return now;
  const parsed = moment.tz(String(value), DAY_FORMAT, true, tz);
  if (!parsed.isValid()) throw new AppError("invalid_week_start", 400);
  return parsed.toDate();
};

const loadStaff = async ({ userId, organizationId }) => {
  const [staff] = await StaffProfile.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        organizationId: toObjectId(organizationId),
        status: StaffProfileStatus.ACTIVE,
      },
    },
    { $project: { branchId: 1 } },
  ]);
  if (!staff) throw new AppError("staff_profile_not_found", 403);
  const [branch] = await Branch.aggregate([
    { $match: { _id: staff.branchId } },
    { $project: { timezone: 1 } },
  ]);
  return {
    staffId: staff._id,
    branchId: staff.branchId,
    timezone: branch?.timezone || DEFAULT_TZ,
  };
};

const scheduledHoursByDay = (shifts, tz) => {
  const byDay = new Map();
  shifts.forEach((shift) => {
    const date = moment.tz(shift.startsAt, tz).format(DAY_FORMAT);
    const minutes = (new Date(shift.endsAt) - new Date(shift.startsAt)) / 60000;
    byDay.set(date, (byDay.get(date) || 0) + minutes);
  });
  return byDay;
};

const attendanceOfWeek = async ({ staffId, days, today, now }) => {
  const rows = await AttendanceDay.aggregate([
    {
      $match: {
        staffId,
        workDate: {
          $gte: new Date(`${days[0].date}T00:00:00Z`),
          $lte: new Date(`${days[6].date}T00:00:00Z`),
        },
      },
    },
    {
      $project: {
        _id: 0,
        workDate: 1,
        workedMinutes: 1,
        clockInAt: 1,
        clockOutAt: 1,
        presenceStatus: 1,
      },
    },
  ]);
  const worked = new Map();
  let onSiteMinutes = null;
  rows.forEach((row) => {
    const date = row.workDate.toISOString().slice(0, 10);
    const open =
      !row.clockOutAt && row.presenceStatus !== PresenceStatus.CHECKED_OUT;
    const minutes = open
      ? Math.max(0, Math.round((now - new Date(row.clockInAt)) / 60000))
      : row.workedMinutes || 0;
    worked.set(date, (worked.get(date) || 0) + minutes);
    if (date === today) {
      onSiteMinutes = (onSiteMinutes || 0) + minutes;
    }
  });
  return { worked, onSiteMinutes };
};

const documentsToSign = async ({ organizationId, branchId, staffId }) => {
  const [row] = await Document.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        requiresSignature: true,
        audiences: DocumentAudience.STAFF,
        $or: [{ branchId }, { branchId: null }],
      },
    },
    {
      $lookup: {
        from: DocumentSignature.collection.name,
        localField: "currentVersionId",
        foreignField: "documentVersionId",
        as: "signatures",
      },
    },
    { $match: { "signatures.signerStaffId": { $ne: staffId } } },
    { $count: "count" },
  ]);
  return row?.count ?? 0;
};

const requirementCard = async ({ actor, organizationId, type }) => {
  const { data, meta } = await myRequirementAssignments({
    actor,
    organizationId,
    type,
    page: 1,
    limit: 500,
    skip: 0,
  });
  const items = data
    .filter((row) => REQUIREMENT_STATUS[row.cellStatus])
    .map((row) => ({
      assignmentId: row.assignmentId,
      name: row.requirement?.name || "",
      status: REQUIREMENT_STATUS[row.cellStatus],
      dueAt: row.dueDate || null,
      completedAt: row.completedAt || null,
    }))
    .sort(byUrgency);
  return {
    compliantPercent: meta.compliance.score,
    needing: items.filter((item) => NEEDS_ACTION.has(item.status)).length,
    items,
  };
};

const meetingCard = (standing) => {
  const meetings = [
    ["Supervision", standing.supervision],
    ["Appraisal", standing.appraisal],
  ];
  const items = meetings.map(([name, meeting]) => ({
    name,
    status: meeting.badge,
    completed: meeting.completed,
    expected: meeting.expected,
    dueAt: meeting.badge === MEETING_BADGES.overdue ? null : meeting.nextDueAt,
  }));
  const done = meetings.reduce(
    (sum, [, meeting]) => sum + Math.min(meeting.completed, meeting.expected),
    0,
  );
  const expected = meetings.reduce(
    (sum, [, meeting]) => sum + meeting.expected,
    0,
  );
  return {
    compliantPercent: expected ? Math.round((done / expected) * 100) : null,
    needing: items.filter((item) =>
      [MEETING_BADGES.overdue, MEETING_BADGES.dueSoon].includes(item.status),
    ).length,
    items,
  };
};

const getStaffDashboard = async ({
  actor,
  organizationId,
  weekStart,
  now = new Date(),
}) => {
  const { staffId, branchId, timezone } = await loadStaff({
    userId: actor._id,
    organizationId,
  });
  const currentWeek = weekDays(now, timezone);
  const shownWeek = weekDays(
    parseWeekStart(weekStart, timezone, now),
    timezone,
  );
  const weekRange = (days) => ({
    from: moment.tz(days[0].date, timezone).startOf("day").toDate(),
    to: moment.tz(days[6].date, timezone).endOf("day").toDate(),
  });

  const [
    attendance,
    currentShifts,
    shownShifts,
    pendingLeave,
    competency,
    training,
    standing,
    notifications,
    openShifts,
    documents,
    attendanceRequests,
  ] = await Promise.all([
    attendanceOfWeek({
      staffId,
      days: currentWeek,
      today: moment.tz(now, timezone).format(DAY_FORMAT),
      now,
    }),
    listMyShifts({
      userId: actor._id,
      organizationId,
      ...weekRange(currentWeek),
    }),
    listMyShifts({
      userId: actor._id,
      organizationId,
      ...weekRange(shownWeek),
    }),
    LeaveRequest.aggregate([
      { $match: { staffId, status: LeaveRequestStatus.PENDING } },
      { $count: "count" },
    ]),
    requirementCard({
      actor,
      organizationId,
      type: RequirementType.COMPETENCY,
    }),
    requirementCard({ actor, organizationId, type: RequirementType.TRAINING }),
    myCompliance({ actor, organizationId }),
    getNotifications({
      receiverId: actor._id,
      page: 1,
      limit: COMMUNICATION_SHOWN,
      timezone,
    }),
    listOpenShifts({ userId: actor._id, organizationId, from: now }),
    documentsToSign({ organizationId, branchId, staffId }),
    AttendanceChangeRequest.aggregate([
      {
        $match: {
          requestedBy: toObjectId(actor._id),
          status: ChangeRequestStatus.PENDING,
        },
      },
      { $count: "count" },
    ]),
  ]);

  const meetings = meetingCard(standing);
  const target = scheduledHoursByDay(currentShifts, timezone);
  const workedMinutes = [...attendance.worked.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const targetMinutes = [...target.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const shownByDay = new Map();
  shownShifts.forEach((shift) => {
    const date = moment.tz(shift.startsAt, timezone).format(DAY_FORMAT);
    shownByDay.set(date, [
      ...(shownByDay.get(date) || []),
      { startsAt: shift.startsAt, endsAt: shift.endsAt },
    ]);
  });

  return {
    summary: {
      onSiteTodayMinutes: attendance.onSiteMinutes,
      hoursThisWeek: hours(workedMinutes),
      hourlyRate: null,
      earnedThisWeek: null,
      pendingLeave: pendingLeave[0]?.count ?? 0,
      complianceDue: competency.needing + training.needing + meetings.needing,
    },
    quickActions: {
      shiftClaims: openShifts.length,
      documents,
      myAttendance: attendanceRequests[0]?.count ?? 0,
    },
    weeklyHours: {
      workedHours: hours(workedMinutes),
      targetHours: hours(targetMinutes),
      days: currentWeek.map(({ day, date }) => ({
        day,
        date,
        workedHours: hours(attendance.worked.get(date) || 0),
        targetHours: hours(target.get(date) || 0),
      })),
    },
    nextShifts: {
      from: shownWeek[0].date,
      to: shownWeek[6].date,
      scheduledHours: hours(
        [...scheduledHoursByDay(shownShifts, timezone).values()].reduce(
          (sum, value) => sum + value,
          0,
        ),
      ),
      days: shownWeek.map(({ day, date }) => ({
        day,
        date,
        shifts: shownByDay.get(date) || [],
      })),
    },
    communication: notifications.data.map(
      ({ title, body, isRead, timeSince }) => ({
        title,
        body,
        isRead,
        timeSince,
      }),
    ),
    compliance: {
      compliantPercent: competency.compliantPercent,
      items: competency.items,
    },
    training: {
      trainingPercent: training.compliantPercent,
      items: training.items,
    },
    supervisionAppraisal: {
      supervisionAppraisalPercent: meetings.compliantPercent,
      items: meetings.items,
    },
    openShifts: openShifts.slice(0, OPEN_SHIFTS_SHOWN).map((shift) => ({
      siteName: shift.branch?.name || "",
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      urgentCover: Boolean(shift.urgentCover),
      openedAt: shift.openedAt || null,
    })),
  };
};

module.exports = { getStaffDashboard };
