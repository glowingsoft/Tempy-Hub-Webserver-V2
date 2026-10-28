const moment = require("moment-timezone");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "Europe/London";

/**
 * Issues follow one another without gaps: the first starts on the anchor day, and each later one starts
 * `issueEveryDays` days after the one before. Days are whole days in the site's own timezone, so a clock
 * change never moves an issue by an hour.
 */
const startOfDay = (value, timezone) => moment.tz(value, timezone || DEFAULT_TIMEZONE).startOf("day");

const periodByIndex = ({ anchorDate, issueEveryDays, timezone, index }) => {
  const start = startOfDay(anchorDate, timezone).add(index * issueEveryDays, "days");
  const end = start.clone().add(issueEveryDays, "days").subtract(1, "millisecond");
  return { index, start: start.toDate(), end: end.toDate(), closesAt: end.toDate() };
};

/** Which issue a moment falls in. Before the anchor it is still the first one, which has not started. */
const indexAt = ({ anchorDate, issueEveryDays, timezone, at = new Date() }) => {
  const anchor = startOfDay(anchorDate, timezone);
  const days = moment.tz(at, timezone || DEFAULT_TIMEZONE).startOf("day").diff(anchor, "days");
  return Math.max(0, Math.floor(days / issueEveryDays));
};

const currentPeriod = (options) => periodByIndex({ ...options, index: indexAt(options) });

const lastClosedPeriod = (options) => {
  const index = indexAt(options) - 1;
  const now = options.at || new Date();
  const anchor = startOfDay(options.anchorDate, options.timezone);
  if (index < 0 || moment(now).isBefore(anchor)) return null;
  return periodByIndex({ ...options, index });
};

/** A gazette asked for by hand when no schedule is set: the last `issueEveryDays` whole days up to today. */
const manualPeriod = ({ issueEveryDays, timezone, at = new Date() }) => {
  const end = startOfDay(at, timezone).add(1, "day").subtract(1, "millisecond");
  const start = startOfDay(at, timezone).subtract(issueEveryDays - 1, "days");
  return { index: null, start: start.toDate(), end: end.toDate(), closesAt: end.toDate() };
};

module.exports = { periodByIndex, indexAt, currentPeriod, lastClosedPeriod, manualPeriod, DAY_MS };
