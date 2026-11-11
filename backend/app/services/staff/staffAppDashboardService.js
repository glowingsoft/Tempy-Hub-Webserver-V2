const { PresenceStatus } = require("@models/domainEnums");
const staffDashboardService = require("@adminServices/dashboard/staffDashboardService");
const attendanceService = require("@adminServices/attendance/attendanceService");
const staffDashboardSettingsService = require("@adminServices/organizations/staffDashboardSettingsService");

const todayAction = (presence, checkInVisible) => {
  if (!checkInVisible) return null;
  if (presence === PresenceStatus.ON_SITE) return "startBreak";
  if (presence === PresenceStatus.ON_BREAK) return "endBreak";
  if (presence === PresenceStatus.ON_LEAVE) return null;
  return "clockIn";
};

const getStaffAppDashboard = async ({ actor, organizationId, weekStart }) => {
  const [visibility, today, dashboard] = await Promise.all([
    staffDashboardSettingsService.getStaffDashboardSettingsForStaff({
      userId: actor._id,
      organizationId,
    }),
    attendanceService.getTodayAttendance({
      userId: actor._id,
      organizationId,
    }),
    staffDashboardService.getStaffDashboard({
      actor,
      organizationId,
      weekStart,
    }),
  ]);

  const presence = today?.attendance?.presenceStatus || null;
  const checkInVisible = Boolean(visibility.cards?.checkIn);

  return {
    visibility,
    today: {
      attendance: today?.attendance || null,
      activeShift: today?.activeShift || null,
      presenceStatus: presence,
      primaryAction: todayAction(presence, checkInVisible),
    },
    dashboard,
  };
};

module.exports = { getStaffAppDashboard };
