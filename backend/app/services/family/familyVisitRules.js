const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { FamilyVisitSettings } = require("@models/FamilyVisitSettings");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("./familyPipeline");

const DEFAULT_TIMEZONE = "Europe/London";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = "YYYY-MM-DD";

const STEP_MINUTES = 30;

/** What a site offers until its staff change it. */
const DEFAULTS = {
  visitingHours: { start: "12:00", end: "18:00" },
  protectedTimes: [],
  daysAhead: 14,
  maxPartySize: 6,
};

const toMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

const toClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A start time is closed when it falls inside a protected window; times are zero-padded HH:mm, so text order is time order. */
const isProtected = (time, rules) =>
  rules.protectedTimes.some((window) => time >= window.start && time < window.end);

const isText = (value) => typeof value === "string";

const timesOf = (rules, { includeProtected = false } = {}) => {
  const times = [];
  const last = toMinutes(rules.visitingHours.end) - STEP_MINUTES;
  for (let minutes = toMinutes(rules.visitingHours.start); minutes <= last; minutes += STEP_MINUTES) {
    const time = toClock(minutes);
    if (includeProtected || !isProtected(time, rules)) times.push(time);
  }
  return times;
};

/** A site's visiting rules: its own settings over the defaults, with the site's timezone. */
const loadRules = async (branchId) => {
  const [row] = await Branch.aggregate([
    { $match: { _id: toObjectId(branchId) } },
    {
      $lookup: {
        from: FamilyVisitSettings.collection.name,
        localField: "_id",
        foreignField: "branchId",
        as: "settings",
      },
    },
    { $project: { timezone: 1, settings: { $arrayElemAt: ["$settings", 0] } } },
  ]);
  if (!row) throw new AppError("branch_not_found", 404);

  const settings = row.settings || {};
  return {
    timezone: row.timezone || DEFAULT_TIMEZONE,
    visitingHours:
      settings.visitingHours?.start && settings.visitingHours?.end
        ? { start: settings.visitingHours.start, end: settings.visitingHours.end }
        : DEFAULTS.visitingHours,
    protectedTimes: settings.protectedTimes || DEFAULTS.protectedTimes,
    daysAhead: settings.daysAhead || DEFAULTS.daysAhead,
    maxPartySize: settings.maxPartySize || DEFAULTS.maxPartySize,
    paused: settings.paused === true,
    pausedReason: settings.pausedReason || "",
    pausedAt: settings.pausedAt || null,
  };
};

const visitingNotice = (rules) => ({
  paused: rules.paused,
  reason: rules.paused ? rules.pausedReason : "",
  since: rules.paused ? rules.pausedAt : null,
});

/** A calendar day and two clock times, read in the site's timezone; anything else is rejected. */
const visitWindow = ({ date, start, end, timezone }) => {
  if (!isText(date) || !moment(date, DATE, true).isValid())
    throw new AppError("invalid_visit_date", 400);
  if (!isText(start) || !isText(end) || !TIME.test(start) || !TIME.test(end))
    throw new AppError("invalid_visit_time", 400);

  const startAt = moment.tz(
    `${date} ${start}`,
    `${DATE} HH:mm`,
    true,
    timezone,
  );
  const endAt = moment.tz(`${date} ${end}`, `${DATE} HH:mm`, true, timezone);
  if (!startAt.isValid() || !endAt.isValid() || !endAt.isAfter(startAt))
    throw new AppError("invalid_visit_time", 400);

  return { startAt: startAt.toDate(), endAt: endAt.toDate() };
};

/** The day must be today or later and no further out than the site allows. */
const assertDayInRange = ({ date, rules, now }) => {
  const today = moment.tz(now, rules.timezone).startOf("day");
  const day = moment.tz(date, DATE, true, rules.timezone);
  if (day.isBefore(today)) throw new AppError("visit_in_past", 400);
  if (day.diff(today, "days") > rules.daysAhead)
    throw new AppError("visit_too_far_ahead", 400, { days: rules.daysAhead });
};

const cleanText = (value, { field, max }) => {
  if (value === undefined || value === null || value === "") return "";
  if (!isText(value)) throw new AppError("invalid_visit_text", 400, { field });
  const text = value.trim();
  if (text.length > max)
    throw new AppError("invalid_visit_text", 400, { field });
  return text;
};

module.exports = {
  DEFAULTS,
  STEP_MINUTES,
  toMinutes,
  timesOf,
  isProtected,
  loadRules,
  visitingNotice,
  visitWindow,
  assertDayInRange,
  cleanText,
  isText,
  TIME,
  DATE,
};
