const moment = require("moment-timezone");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { StaffProfileStatus, PresenceStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const shiftService = require("@adminServices/rota/shiftService");
const attendanceService = require("@adminServices/attendance/attendanceService");

const DEFAULT_TZ = "Europe/London";
const HOME_SHIFT_LIMIT = 5;
const HOME_LOOKAHEAD_DAYS = 14;

const greetingForHour = (hour) => {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
};

const statusFromAttendance = (attendance, clockInEligible) => {
  const presence = attendance?.presenceStatus || null;
  if (presence === PresenceStatus.ON_SITE) {
    return { label: "On Shift", presenceStatus: presence, clockInEligible };
  }
  if (presence === PresenceStatus.ON_BREAK) {
    return { label: "On Break", presenceStatus: presence, clockInEligible };
  }
  return {
    label: clockInEligible ? "Ready to check in" : "Off Shift",
    presenceStatus: presence,
    clockInEligible,
  };
};

const getStaffHome = async ({ userId, organizationId, userName }) => {
  const profile = await StaffProfile.findOne({
    userId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id branchId")
    .lean();

  if (!profile) throw new AppError("staff_profile_not_found", 403);

  const branch = profile.branchId
    ? await Branch.findById(profile.branchId).select("timezone").lean()
    : null;
  const tz = branch?.timezone || DEFAULT_TZ;
  const now = moment.tz(tz);
  const todayStart = now.clone().startOf("day");
  const todayEnd = now.clone().endOf("day");
  const rangeEnd = todayStart.clone().add(HOME_LOOKAHEAD_DAYS, "days").endOf("day");

  const [shifts, today] = await Promise.all([
    shiftService.listMyShifts({
      userId,
      organizationId,
      from: todayStart.toDate(),
      to: rangeEnd.toDate(),
      page: 1,
      limit: 50,
      skip: 0,
    }),
    attendanceService.getTodayAttendance({ userId, organizationId }),
  ]);

  const todaysShifts = shifts.data
    .filter((shift) => moment(shift.startsAt).tz(tz).isSame(todayStart, "day"))
    .slice(0, HOME_SHIFT_LIMIT);

  const nextAssignedShifts = shifts.data
    .filter((shift) => moment(shift.startsAt).tz(tz).isAfter(todayEnd))
    .slice(0, HOME_SHIFT_LIMIT);

  const nextAssignedShift =
    shifts.data.find((shift) => moment(shift.endsAt).tz(tz).isSameOrAfter(now)) ||
    null;

  const presence = today?.attendance?.presenceStatus;
  const clockInEligible =
    presence !== PresenceStatus.ON_SITE &&
    presence !== PresenceStatus.ON_BREAK;

  return {
    greeting: greetingForHour(now.hour()),
    name: userName || "",
    timezone: tz,
    todaysShifts,
    nextAssignedShifts,
    nextAssignedShift,
    status: statusFromAttendance(today?.attendance, clockInEligible),
    attendance: today?.attendance || null,
    activeShift: today?.activeShift || null,
  };
};

module.exports = {
  getHome: getStaffHome,
  getStaffHome,
};
