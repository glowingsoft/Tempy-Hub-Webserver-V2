const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { FamilyVisitSettings } = require("@models/FamilyVisitSettings");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("./familyPipeline");

const DEFAULT_TIMEZONE = "Europe/London";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = "YYYY-MM-DD";

/** What a site offers until its staff change it. */
const DEFAULTS = {
  slots: [
    { start: "10:00", end: "12:00" },
    { start: "14:00", end: "16:00" },
    { start: "16:00", end: "18:00" },
  ],
  places: [
    { name: "Resident's room", capacity: null },
    { name: "Garden Lounge", capacity: 4 },
  ],
  protectedTimes: [],
  daysAhead: 14,
  maxPartySize: 6,
};

const slotId = ({ start, end }) => `${start}-${end}`;

const placeOf = (place) => ({
  name: typeof place === "string" ? place : place.name,
  capacity: (typeof place === "string" ? null : place.capacity) ?? null,
});

/** A slot is closed when it overlaps any protected window; times are zero-padded HH:mm, so text order is time order. */
const isProtected = (slot, rules) =>
  rules.protectedTimes.some(
    (window) => slot.start < window.end && slot.end > window.start,
  );

const isText = (value) => typeof value === "string";

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
    slots: settings.slots?.length ? settings.slots : DEFAULTS.slots,
    places: (settings.places?.length ? settings.places : DEFAULTS.places).map(placeOf),
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
  slotId,
  placeOf,
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
