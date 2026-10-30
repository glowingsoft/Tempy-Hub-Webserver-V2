const moment = require("moment-timezone");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyVisit } = require("@models/FamilyVisit");
const { FamilyVisitSettings } = require("@models/FamilyVisitSettings");
const { FamilyVisitStatus, FamilyVisitSource } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/residents/residentAccess");
const { requireManageableResident } = require("./familyService");
const { listScope } = require("./familyStaffService");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
  personFields,
} = require("@appServices/family/familyPipeline");
const {
  slotId,
  isProtected,
  loadRules,
  visitingNotice,
  visitWindow,
  assertDayInRange,
  cleanText,
  isText,
  TIME,
  DATE,
} = require("@appServices/family/familyVisitRules");
const { seatsInRange } = require("@appServices/family/familyVisitCapacity");
const {
  notifyVisitInvited,
  notifyVisitDecision,
} = require("@appServices/family/familyVisitNotifications");
const { cancelUpcomingVisits } = require("./familyVisitPause");
const {
  issueInvitation,
  cancelInvitation,
} = require("@appServices/family/familyVisitInvitation");

const VisitRange = { UPCOMING: "upcoming", PAST: "past" };
const VisitDecision = {
  CONFIRM: "confirm",
  DECLINE: "decline",
  CANCEL: "cancel",
};

const MAX_SLOTS = 12;
const MAX_PROTECTED = 6;
const MAX_LABEL_LENGTH = 40;
const MAX_PLACES = 20;
const MAX_PLACE_LENGTH = 60;
const MAX_NOTE_LENGTH = 500;
const MAX_REASON_LENGTH = 200;

const joinRequester = joinOne({
  from: User,
  localField: "requestedBy",
  as: "requester",
  optional: true,
});
const joinResident = joinOne({
  from: Resident,
  localField: "residentId",
  as: "resident",
  optional: true,
});

const countReplies = (response) => ({
  $size: {
    $filter: {
      input: "$replies",
      as: "reply",
      cond: { $eq: ["$$reply.response", response] },
    },
  },
});

const assertEnum = (value, allowed, key) => {
  if (value !== undefined && !Object.values(allowed).includes(value))
    throw new AppError(key, 400);
};

/** Visit requests and home invitations for a resident, a site, or everything the caller's role covers. */
const listVisits = async ({
  actor,
  organizationId,
  branchId,
  residentId,
  status,
  source,
  range,
  withVisiting = false,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  assertEnum(status, FamilyVisitStatus, "invalid_visit_status");
  assertEnum(source, FamilyVisitSource, "invalid_visit_source");
  assertEnum(range, VisitRange, "invalid_visit_tab");

  const match = await listScope({
    actor,
    organizationId,
    branchId,
    residentId,
  });
  if (status) match.status = status;
  if (source) match.source = source;
  if (range)
    match.endAt = range === VisitRange.PAST ? { $lt: now } : { $gte: now };

  const result = await paginateWithFacet({
    model: FamilyVisit,
    match,
    page,
    limit,
    skip,
    sort: { startAt: range === VisitRange.PAST ? -1 : 1, _id: 1 },
    extraDataStages: [
      ...joinRequester,
      ...joinResident,
      {
        $project: {
          _id: 0,
          id: "$_id",
          branchId: 1,
          residentId: 1,
          residentName: { $ifNull: ["$resident.name", ""] },
          source: 1,
          status: 1,
          startAt: 1,
          endAt: 1,
          place: 1,
          partySize: 1,
          note: 1,
          decisionNote: 1,
          decidedAt: 1,
          requestedBy: {
            $cond: [
              { $eq: ["$source", FamilyVisitSource.FAMILY] },
              {
                ...personFields("requester"),
                email: { $ifNull: ["$requester.email", ""] },
              },
              null,
            ],
          },
          answers: {
            going: countReplies("going"),
            cantMakeIt: countReplies("cantMakeIt"),
          },
          createdAt: 1,
        },
      },
    ],
  });

  if (!withVisiting) return result;
  const visiting = match.branchId
    ? visitingNotice(await loadRules(match.branchId))
    : null;
  return { ...result, meta: { ...result.meta, visiting } };
};

/** The home invites a resident's family to a visit; each member answers for themselves. */
const inviteFamily = async ({
  actor,
  organizationId,
  residentId,
  date,
  startTime,
  endTime,
  place,
  note,
  now = new Date(),
}) => {
  if (!isValidObjectId(residentId))
    throw new AppError("invalid_resident_id", 400);
  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId,
  });
  const rules = await loadRules(resident.branchId);

  const { startAt, endAt } = visitWindow({
    date,
    start: startTime,
    end: endTime,
    timezone: rules.timezone,
  });
  assertDayInRange({ date, rules, now });
  if (startAt <= now) throw new AppError("visit_in_past", 400);

  const visit = await FamilyVisit.create({
    organizationId: resident.organizationId,
    branchId: resident.branchId,
    residentId: resident._id,
    source: FamilyVisitSource.HOME,
    invitedBy: actor._id,
    startAt,
    endAt,
    place: cleanText(place, { field: "place", max: MAX_PLACE_LENGTH }),
    note: cleanText(note, { field: "note", max: MAX_NOTE_LENGTH }),
    status: FamilyVisitStatus.INVITED,
  });
  await notifyVisitInvited({ visit });
  return { id: visit._id, status: visit.status };
};

const loadVisit = async ({ actor, organizationId, visitId }) => {
  if (!isValidObjectId(visitId)) throw new AppError("visit_not_found", 404);
  const visit = await FamilyVisit.findOne({
    _id: toObjectId(visitId),
    organizationId: toObjectId(organizationId),
  }).lean();
  if (!visit) throw new AppError("visit_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayAccessResidents(standing, visit.branchId);
  return visit;
};

const settle = async ({ actor, visit, decision, note, now }) => {
  const confirm = decision === VisitDecision.CONFIRM;
  const claimed = await FamilyVisit.findOneAndUpdate(
    {
      _id: visit._id,
      source: FamilyVisitSource.FAMILY,
      status: FamilyVisitStatus.REQUESTED,
      endAt: { $gt: now },
    },
    {
      $set: {
        status: confirm
          ? FamilyVisitStatus.CONFIRMED
          : FamilyVisitStatus.DECLINED,
        decidedBy: actor._id,
        decidedAt: now,
        decisionNote: cleanText(note, {
          field: "note",
          max: MAX_REASON_LENGTH,
        }),
      },
    },
    { new: true },
  ).lean();
  if (!claimed) throw new AppError("visit_not_pending", 409);
  if (!confirm) return claimed;

  try {
    const [requester, resident] = await Promise.all([
      User.findById(claimed.requestedBy).select("name email").lean(),
      Resident.findById(claimed.residentId).select("name").lean(),
    ]);
    const invitation = await issueInvitation({
      visit: claimed,
      visitorName: requester?.name || "Family visitor",
      visitorEmail: requester?.email || "",
      residentName: resident?.name || "",
      createdBy: actor._id,
    });
    await FamilyVisit.updateOne(
      { _id: claimed._id },
      { $set: { invitationId: invitation._id } },
    );
    return { ...claimed, invitationId: invitation._id };
  } catch (error) {
    await FamilyVisit.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: FamilyVisitStatus.REQUESTED,
          decidedBy: null,
          decidedAt: null,
          decisionNote: "",
        },
      },
    );
    throw error;
  }
};

const withdraw = async ({ actor, visit, now }) => {
  const claimed = await FamilyVisit.findOneAndUpdate(
    {
      _id: visit._id,
      status: {
        $in: [
          FamilyVisitStatus.REQUESTED,
          FamilyVisitStatus.CONFIRMED,
          FamilyVisitStatus.INVITED,
        ],
      },
      endAt: { $gt: now },
    },
    {
      $set: {
        status: FamilyVisitStatus.CANCELLED,
        decidedBy: actor._id,
        decidedAt: now,
      },
    },
    { new: true },
  ).lean();
  if (!claimed) throw new AppError("visit_not_cancellable", 409);

  const invitationIds = [
    claimed.invitationId,
    ...claimed.replies.map((reply) => reply.invitationId),
  ].filter(Boolean);
  await Promise.all(
    invitationIds.map((invitationId) =>
      cancelInvitation({ invitationId, userId: actor._id, now }),
    ),
  );
  return claimed;
};

/** Confirm or decline a family's request, or cancel a visit the home no longer wants. */
const decideVisit = async ({
  actor,
  organizationId,
  visitId,
  decision,
  note,
  now = new Date(),
}) => {
  const visit = await loadVisit({ actor, organizationId, visitId });
  const result =
    decision === VisitDecision.CANCEL
      ? await withdraw({ actor, visit, now })
      : await settle({ actor, visit, decision, note, now });
  await notifyVisitDecision({ visit: result, decision, actorId: actor._id });
  return { id: result._id, status: result.status, decidedAt: result.decidedAt };
};

const settingsView = (rules, branchId) => ({
  branchId,
  timezone: rules.timezone,
  slots: rules.slots.map((slot) => ({ id: slotId(slot), ...slot })),
  places: rules.places,
  protectedTimes: rules.protectedTimes.map(({ start, end, label }) => ({
    start,
    end,
    label: label || "",
  })),
  daysAhead: rules.daysAhead,
  maxPartySize: rules.maxPartySize,
  paused: rules.paused,
  pausedReason: rules.pausedReason,
  pausedAt: rules.pausedAt,
});

const requireSite = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId);
  if (!scoped) throw new AppError("branch_required", 400);
  assertMayAccessResidents(standing, scoped);
  await assertBranchInOrganization(scoped, organizationId);
  return String(scoped);
};

const getSettings = async ({ actor, organizationId, branchId }) => {
  const site = await requireSite({ actor, organizationId, branchId });
  return settingsView(await loadRules(site), site);
};

const cleanSlots = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SLOTS)
    throw new AppError("invalid_visit_settings", 400, { field: "slots" });

  const slots = value.map((slot) => {
    const start = slot?.start;
    const end = slot?.end;
    if (
      !isText(start) ||
      !isText(end) ||
      !TIME.test(start) ||
      !TIME.test(end) ||
      end <= start
    )
      throw new AppError("invalid_visit_settings", 400, { field: "slots" });
    return { start, end };
  });
  if (new Set(slots.map(slotId)).size !== slots.length)
    throw new AppError("invalid_visit_settings", 400, { field: "slots" });
  return slots.sort((a, b) => a.start.localeCompare(b.start));
};

const cleanPlaces = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PLACES)
    throw new AppError("invalid_visit_settings", 400, { field: "places" });

  const places = value.map((place) => {
    const name = isText(place) ? place : place?.name;
    const text = isText(name) ? name.trim() : "";
    const capacity = isText(place) ? null : (place?.capacity ?? null);
    if (
      !text ||
      text.length > MAX_PLACE_LENGTH ||
      (capacity !== null &&
        (!Number.isInteger(capacity) || capacity < 1 || capacity > 500))
    )
      throw new AppError("invalid_visit_settings", 400, { field: "places" });
    return { name: text, capacity };
  });
  if (new Set(places.map((place) => place.name)).size !== places.length)
    throw new AppError("invalid_visit_settings", 400, { field: "places" });
  return places;
};

const cleanProtectedTimes = (value) => {
  if (!Array.isArray(value) || value.length > MAX_PROTECTED)
    throw new AppError("invalid_visit_settings", 400, {
      field: "protectedTimes",
    });

  return value.map((window) => {
    const { start, end } = window || {};
    const label = window?.label === undefined ? "" : window.label;
    if (
      !isText(start) ||
      !isText(end) ||
      !TIME.test(start) ||
      !TIME.test(end) ||
      end <= start ||
      !isText(label) ||
      label.trim().length > MAX_LABEL_LENGTH
    )
      throw new AppError("invalid_visit_settings", 400, {
        field: "protectedTimes",
      });
    return { start, end, label: label.trim() };
  });
};

const cleanWhole = (value, { field, min, max }) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AppError("invalid_visit_settings", 400, { field });
  return value;
};

/** Saves what a site offers on Book A Visit, and pauses or resumes visiting; fields left out stay as they were. */
const updateSettings = async ({
  actor,
  organizationId,
  branchId,
  body = {},
  now = new Date(),
}) => {
  const site = await requireSite({ actor, organizationId, branchId });
  const before = await loadRules(site);
  const set = {};

  if (body.slots !== undefined) set.slots = cleanSlots(body.slots);
  if (body.places !== undefined) set.places = cleanPlaces(body.places);
  if (body.protectedTimes !== undefined)
    set.protectedTimes = cleanProtectedTimes(body.protectedTimes);
  if (body.daysAhead !== undefined)
    set.daysAhead = cleanWhole(body.daysAhead, {
      field: "daysAhead",
      min: 1,
      max: 60,
    });
  if (body.maxPartySize !== undefined)
    set.maxPartySize = cleanWhole(body.maxPartySize, {
      field: "maxPartySize",
      min: 1,
      max: 20,
    });

  if (body.paused !== undefined) {
    if (typeof body.paused !== "boolean")
      throw new AppError("invalid_visit_settings", 400, { field: "paused" });
    set.paused = body.paused;
    set.pausedReason = body.paused
      ? cleanText(body.pausedReason, {
          field: "pausedReason",
          max: MAX_REASON_LENGTH,
        })
      : "";
    set.pausedAt = body.paused ? now : null;
    set.pausedBy = body.paused ? actor._id : null;
  }
  if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);

  await FamilyVisitSettings.updateOne(
    { branchId: toObjectId(site) },
    {
      $set: set,
      $setOnInsert: { organizationId: toObjectId(organizationId) },
    },
    { upsert: true },
  );

  // Pausing cancels what is booked; sending paused again changes nothing.
  const pausing = body.paused === true && !before.paused;
  const { cancelled } = pausing
    ? await cancelUpcomingVisits({
        organizationId,
        branchId: site,
        actorId: actor._id,
        reason: set.pausedReason,
        now,
      })
    : { cancelled: 0 };
  return { ...settingsView(await loadRules(site), site), cancelled };
};

/** Pause Visiting: stops new requests and cancels the visits still to come, telling the families affected. */
const setVisiting = ({
  actor,
  organizationId,
  branchId,
  paused,
  reason,
  now,
}) =>
  updateSettings({
    actor,
    organizationId,
    branchId,
    body: { paused, pausedReason: reason },
    now,
  });

/** The capacity card for one day: seats taken against seats available for each limited place and time, and the closed times. */
const getCapacity = async ({
  actor,
  organizationId,
  branchId,
  date,
  now = new Date(),
}) => {
  const site = await requireSite({ actor, organizationId, branchId });
  const rules = await loadRules(site);
  const day =
    date === undefined ? moment.tz(now, rules.timezone).format(DATE) : date;
  const { startAt: from } = visitWindow({
    date: day,
    start: "00:00",
    end: "23:59",
    timezone: rules.timezone,
  });
  const to = moment.tz(day, DATE, true, rules.timezone).add(1, "day").toDate();
  const held = await seatsInRange({ branchId: site, from, to });

  const times = rules.slots
    .filter((slot) => !isProtected(slot, rules))
    .map((slot) => ({
      slot,
      startAt: visitWindow({
        date: day,
        start: slot.start,
        end: slot.end,
        timezone: rules.timezone,
      }).startAt,
    }));

  return {
    date: day,
    weekday: moment.tz(day, DATE, true, rules.timezone).format("dddd"),
    timezone: rules.timezone,
    visiting: visitingNotice(rules),
    protectedTimes: rules.protectedTimes.map(({ start, end, label }) => ({
      start,
      end,
      label: label || "Protected time",
      note: `${label || "Protected time"} ${start} - ${end} isn't bookable.`,
    })),
    spaces: rules.places
      .filter((place) => place.capacity !== null)
      .map((place) => ({
        place: place.name,
        capacity: place.capacity,
        slots: times.map(({ slot, startAt }) => {
          const booked = held.get(`${place.name}|${startAt.getTime()}`) ?? 0;
          return {
            id: slotId(slot),
            start: slot.start,
            end: slot.end,
            booked,
            capacity: place.capacity,
            full: booked >= place.capacity,
          };
        }),
      })),
  };
};

module.exports = {
  VisitDecision,
  listVisits,
  inviteFamily,
  decideVisit,
  getSettings,
  updateSettings,
  setVisiting,
  getCapacity,
};
