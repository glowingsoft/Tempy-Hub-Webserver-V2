const { PresenceStatus } = require("@models/domainEnums");
const attendanceService = require("@adminServices/attendance/attendanceService");

const myStatusFromAttendance = (today) => {
  const presence = today?.attendance?.presenceStatus || null;
  if (presence === PresenceStatus.ON_SITE) {
    return { label: "On Shift", presenceStatus: presence };
  }
  if (presence === PresenceStatus.ON_BREAK) {
    return { label: "On Break", presenceStatus: presence };
  }
  return { label: "Normal", presenceStatus: presence };
};

const loadMyStatus = async ({ userId, organizationId }) => {
  try {
    const today = await attendanceService.getTodayAttendance({
      userId,
      organizationId,
    });
    return myStatusFromAttendance(today);
  } catch (error) {
    if (error.translationKey === "staff_profile_not_found") return null;
    throw error;
  }
};

module.exports = { loadMyStatus, myStatusFromAttendance };
