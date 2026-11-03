const moment = require("moment-timezone");

const DEFAULT_TZ = "Europe/London";

const inZone = (value, timezone) => {
  const tz = timezone || DEFAULT_TZ;
  if (value == null || value === "") return moment.tz(tz);
  if (moment.isMoment(value)) return value.clone().tz(tz);
  if (value instanceof Date) return moment(value).tz(tz);
  return moment.tz(value, tz);
};

/**
 * One walk of due dates, one walk of meetings.
 * Score is completed / required so far, capped at 100. Null means nothing is due yet.
 */
const supervisionStanding = ({
  startDate,
  intervalMonths,
  meetings = [],
  checkDate,
  timezone,
}) => {
  const tz = timezone || DEFAULT_TZ;
  const now = inZone(checkDate, tz);
  const today = now.clone().startOf("day");
  const interval = intervalMonths || 3;

  let cycleStart = inZone(startDate, tz);
  let cycleEnd = cycleStart.clone().add(12, "months");
  while (cycleEnd.clone().startOf("day").isSameOrBefore(today)) {
    cycleStart = cycleEnd;
    cycleEnd = cycleStart.clone().add(12, "months");
  }

  let required = 0;
  let expectedThisCycle = 0;
  let nextDue = null;
  const due = inZone(startDate, tz).add(interval, "months");
  while (true) {
    const dueDay = due.clone().startOf("day");
    if (dueDay.isSameOrBefore(today)) required += 1;
    if (!nextDue && !dueDay.isBefore(today)) nextDue = due.clone();

    if (!due.isBefore(cycleStart) && due.isBefore(cycleEnd)) expectedThisCycle += 1;

    const pastThisCycle = !due.isBefore(cycleEnd);
    due.add(interval, "months");
    if (nextDue && pastThisCycle) break;
  }

  let completed = 0;
  let completedThisCycle = 0;
  let lastCompletedAt = null;
  let lastAt = null;
  let upcoming = null;
  let upcomingAt = null;

  for (const meeting of meetings) {
    if (meeting.status === "completed" && meeting.completedAt) {
      const at = inZone(meeting.completedAt, tz);
      if (at.isSameOrBefore(now)) completed += 1;
      if (!at.isBefore(cycleStart) && at.isBefore(cycleEnd)) completedThisCycle += 1;
      if (!lastAt || at.isAfter(lastAt)) {
        lastAt = at;
        lastCompletedAt = meeting.completedAt;
      }
      continue;
    }

    if (meeting.status !== "scheduled" || !meeting.scheduledAt) continue;
    const at = inZone(meeting.scheduledAt, tz);
    if (at.isBefore(now)) continue;
    if (!upcomingAt || at.isBefore(upcomingAt)) {
      upcomingAt = at;
      upcoming = meeting;
    }
  }

  const daysUntilDue = nextDue.clone().startOf("day").diff(today, "days");
  let badge = "onTrack";
  if (required === 0) badge = "notYetDue";
  else if (completed < required) badge = "overdue";
  else if (upcoming) badge = "booked";
  else if (daysUntilDue <= 30) badge = "dueSoon";

  return {
    intervalMonths: interval,
    required,
    completed,
    score: required === 0 ? null : Math.min(100, Math.round((completed / required) * 100)),
    nextDueAt: nextDue.toDate(),
    badge,
    upcoming,
    expectedThisCycle,
    completedThisCycle,
    lastCompletedAt,
  };
};

module.exports = { DEFAULT_TZ, inZone, supervisionStanding };
