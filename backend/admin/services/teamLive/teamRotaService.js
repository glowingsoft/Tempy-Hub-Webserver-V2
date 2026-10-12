const moment = require("moment-timezone");
const { AppError } = require("@services/_errors/AppError");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const {
  ShiftStatus,
  LeaveType,
  PunctualityStatus,
} = require("@models/domainEnums");
const { actorStanding } = require("@adminServices/staff/staffAccess");
const shiftService = require("@adminServices/rota/shiftService");
const attendanceService = require("@adminServices/attendance/attendanceService");

const DEFAULT_TZ = "Europe/London";
const VIEWS = ["day", "week"];
const SHIFT_PAGE_SIZE = 500;

const loadTimezone = async (standing) => {
  if (!standing.branchId) return DEFAULT_TZ;
  const branch = await Branch.findById(standing.branchId)
    .select("timezone")
    .lean();
  return branch?.timezone || DEFAULT_TZ;
};

const resolveRange = ({ date, view, tz }) => {
  const key = String(view || "day").toLowerCase();
  if (!VIEWS.includes(key)) throw new AppError("invalid_view", 400);

  const day = date
    ? moment.tz(date, "YYYY-MM-DD", tz)
    : moment.tz(tz);
  if (!day.isValid()) throw new AppError("invalid_date_format", 400);

  if (key === "week") {
    return {
      view: key,
      from: day.clone().startOf("isoWeek"),
      to: day.clone().endOf("isoWeek"),
    };
  }
  return {
    view: key,
    from: day.clone().startOf("day"),
    to: day.clone().endOf("day"),
  };
};

const chipFromCell = (cell) => {
  if (!cell || cell.kind === "empty") return null;
  if (cell.kind === "leave" && cell.leaveType === LeaveType.SICK) return "sick";
  if (cell.punctualityStatus === PunctualityStatus.LATE) return "late";
  return null;
};

const cellsByStaffDate = (rota) => {
  const map = new Map();
  for (const week of rota.weeks || []) {
    for (const row of week.staff || []) {
      const staffId = String(row.staff?._id || "");
      for (const [workDate, cell] of Object.entries(row.days || {})) {
        map.set(`${staffId}:${workDate}`, cell);
      }
    }
  }
  return map;
};

const departmentName = (profile) => {
  const first = profile?.departmentIds?.[0];
  if (!first) return "";
  if (typeof first === "object") return first.name || "";
  return "";
};

const getTeamRota = async ({
  actor,
  organizationId,
  date,
  view,
  departmentId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const tz = await loadTimezone(standing);
  const range = resolveRange({ date, view, tz });
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [shifts, rota] = await Promise.all([
    shiftService.listShifts({
      organizationId,
      actor,
      from: range.from.clone().subtract(12, "hours").toISOString(),
      to: toIso,
      page: 1,
      limit: SHIFT_PAGE_SIZE,
      skip: 0,
    }),
    attendanceService.listAttendanceRota({
      organizationId,
      actor,
      from: range.from.format("YYYY-MM-DD"),
      to: range.to.format("YYYY-MM-DD"),
      timezone: tz,
    }),
  ]);

  const overlapping = (shifts.data || []).filter((shift) => {
    if (!shift.staffId) return false;
    if (
      shift.status !== ShiftStatus.SCHEDULED &&
      shift.status !== ShiftStatus.COMPLETED
    ) {
      return false;
    }
    const starts = new Date(shift.startsAt);
    const ends = new Date(shift.endsAt);
    return starts < range.to.toDate() && ends > range.from.toDate();
  });

  const staffIds = [
    ...new Set(overlapping.map((shift) => String(shift.staffId))),
  ];
  const profiles = staffIds.length
    ? await StaffProfile.find({ _id: { $in: staffIds } })
        .select("departmentIds")
        .populate("departmentIds", "name")
        .lean()
    : [];
  const profileById = new Map(profiles.map((row) => [String(row._id), row]));
  const cells = cellsByStaffDate(rota);

  const items = [];
  for (const shift of overlapping) {
    const staffId = String(shift.staffId);
    const profile = profileById.get(staffId);
    if (
      departmentId &&
      !(profile?.departmentIds || []).some(
        (dept) => String(dept._id || dept) === String(departmentId)
      )
    ) {
      continue;
    }

    const workDate = moment(shift.startsAt).tz(tz).format("YYYY-MM-DD");
    const cell = cells.get(`${staffId}:${workDate}`);

    items.push({
      shiftId: shift._id,
      staffId: shift.staffId,
      staffName: shift.staff?.name || "",
      department: departmentName(profile),
      workDate,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      clockInAt: cell?.clockInAt || null,
      chip: chipFromCell(cell),
    });
  }

  items.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  return {
    view: range.view,
    from: range.from.format("YYYY-MM-DD"),
    to: range.to.format("YYYY-MM-DD"),
    items,
  };
};

module.exports = { getTeamRota };
