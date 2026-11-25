const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { VisitSession } = require("@models/VisitSession");
const { FamilyVisit } = require("@models/FamilyVisit");
const { PeepRecord } = require("@models/PeepRecord");
const { AttendanceDay } = require("@models/AttendanceDay");
const { Membership } = require("@models/Membership");
const { NotificationExp, NotificationTypes } = require("@models/Notifications");
const {
  DrillKind,
  EvacuationType,
  EvacuationStatus,
  EvacPersonKind,
  FamilyAlertStatus,
  ActiveInactiveStatus,
  MembershipRole,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { generateMeta } = require("@utils/responseUtil");
const { sendUserNotifications } = require("@commonServices/communication/communicationService");
const { resolveLiveBranchId } = require("@adminServices/siteLive/siteLiveService");
const { actorStanding, assertMayManageStaff } = require("@adminServices/staff/staffAccess");
const { toObjectId, isValidObjectId } = require("@appServices/family/familyPipeline");

const DEFAULT_TZ = "Europe/London";
const YEARLY_TARGET = 4;
const NIGHT_FROM = 20;
const NIGHT_UNTIL = 8;
const NOTIFY_CHUNK = 500;
const MAX_AREA = 80;
const MAX_CAUSE = 120;
const MAX_ISSUES = 20;
const MAX_ISSUE_LENGTH = 200;
const MAX_NOTES = 1000;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

const PROGRESS = [
  { key: DrillKind.DAY, label: "Day Drills" },
  { key: DrillKind.NIGHT, label: "Night Care" },
  { key: DrillKind.COMPARTMENT, label: "Compartment" },
];

const KIND_TITLES = {
  [DrillKind.DAY]: "Day Drill",
  [DrillKind.NIGHT]: "Night Drill",
  [DrillKind.COMPARTMENT]: "Compartment Drill",
  [DrillKind.FALSE_ALARM]: "False Alarm",
};

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

const clock = (value, timezone) => (value ? moment(value).tz(timezone).format("HH:mm") : "");

const hourKind = (startedAt, timezone) => {
  const hour = moment(startedAt).tz(timezone).hour();
  return hour >= NIGHT_FROM || hour < NIGHT_UNTIL ? DrillKind.NIGHT : DrillKind.DAY;
};

// A drill raised from a phone or kiosk carries no kind, so its start time decides day or night.
const kindOf = (event, timezone) => {
  if (event.drillKind) return event.drillKind;
  if (event.type === EvacuationType.MOCK) return hourKind(event.startedAt, timezone);
  return null;
};

const durationParts = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return { minutes, rest };
};

const presentHistory = (event, timezone) => {
  const kind = kindOf(event, timezone);
  const seconds =
    event.closedAt && event.startedAt
      ? Math.max(Math.round((new Date(event.closedAt) - new Date(event.startedAt)) / 1000), 0)
      : null;
  const issues = event.issues || [];
  let line = [];
  if (seconds !== null) {
    const { minutes, rest } = durationParts(seconds);
    if (kind === DrillKind.FALSE_ALARM || event.type === EvacuationType.REAL) {
      line = [
        [event.cause, event.area].filter(Boolean).join(", "),
        `Cleared in ${Math.max(Math.round(seconds / 60), 1)} min`,
      ];
    } else if (kind !== DrillKind.COMPARTMENT) {
      line = [
        `Evacuated in ${minutes}m ${rest}s`,
        issues.length ? `${plural(issues.length, "issue")} logged` : "",
      ];
    }
  }
  if (kind === DrillKind.COMPARTMENT) {
    line = [
      event.area,
      Number.isInteger(event.residentsMoved)
        ? `${event.residentsMoved} ${event.residentsMoved === 1 ? "Resident" : "Residents"} Moved`
        : "",
    ];
  }

  const isEvent = kind === DrillKind.FALSE_ALARM || (!kind && event.type === EvacuationType.REAL);
  const tag =
    kind === DrillKind.COMPARTMENT
      ? { key: "compartment", label: "Compartment" }
      : isEvent
        ? { key: "event", label: "Event" }
        : { key: "drill", label: "Drill" };

  return {
    _id: event._id,
    title: `${KIND_TITLES[kind] || "Real Fire"} - ${moment(event.startedAt).tz(timezone).format("D MMM")}`,
    subtitle: line.filter(Boolean).join(" - "),
    tag,
    type: event.type,
    kind,
    status: event.status,
    startedAt: event.startedAt,
    closedAt: event.closedAt,
    durationSeconds: seconds,
    area: event.area || "",
    cause: event.cause || "",
    issues,
    residentsMoved: event.residentsMoved ?? null,
    notes: event.notes || "",
  };
};

const progressOf = (events, timezone, now) => {
  const today = moment(now).tz(timezone);
  const done = {};
  events.forEach((event) => {
    if (event.status !== EvacuationStatus.CLOSED) return;
    if (moment(event.startedAt).tz(timezone).year() !== today.year()) return;
    const kind = kindOf(event, timezone);
    if (kind) done[kind] = (done[kind] || 0) + 1;
  });
  const expected = Math.floor((YEARLY_TARGET * (today.month() + 1)) / 12);
  const items = PROGRESS.map(({ key, label }) => {
    const count = done[key] || 0;
    return {
      key,
      label,
      done: count,
      target: YEARLY_TARGET,
      percent: Math.min(Math.round((count / YEARLY_TARGET) * 100), 100),
      progressLabel: `${count}/${YEARLY_TARGET}`,
      onTrack: count >= expected,
    };
  });
  const latest = events.find((event) => event.area && event.type === EvacuationType.MOCK) || events[0];
  const onTrack = items.every((item) => item.onTrack);
  return {
    title: latest
      ? `${latest.area || "Last Drill"} On ${moment(latest.startedAt).tz(timezone).format("ddd D MMM")}`
      : "No Drills Yet",
    year: today.year(),
    status: onTrack
      ? { key: "onTrack", label: "On Track" }
      : { key: "behind", label: "Behind" },
    items,
  };
};

const getFireDrills = async ({ actor, organizationId, branchId, page, limit, skip, now = new Date() }) => {
  const siteId = await resolveLiveBranchId({ actor, organizationId, branchId });
  const branch = await Branch.findById(siteId).select("name timezone").lean();
  const timezone = branch?.timezone || DEFAULT_TZ;
  const events = await EvacuationEvent.find({ branchId: siteId })
    .sort({ startedAt: -1 })
    .lean();
  const history = events.filter((event) => event.status === EvacuationStatus.CLOSED);
  const active = events.find((event) => event.status === EvacuationStatus.ACTIVE);

  return {
    branch: { _id: siteId, name: branch?.name || "" },
    isEvacuationActive: Boolean(active),
    activeEvacuationId: active?._id || null,
    activeEvacuationType: active?.type || null,
    progress: progressOf(history, timezone, now),
    history: history.slice(skip, skip + limit).map((event) => presentHistory(event, timezone)),
    meta: generateMeta(page, limit, history.length),
  };
};

const text = (value, max, field) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length > max)
    throw new AppError("invalid_drill_log", 400, { field });
  return value.trim();
};

const wholeNumber = (value, max, field) => {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new AppError("invalid_drill_log", 400, { field });
  return value;
};

const cleanDetails = (body) => {
  const details = {
    area: text(body.area, MAX_AREA, "area"),
    cause: text(body.cause, MAX_CAUSE, "cause"),
    notes: text(body.notes, MAX_NOTES, "notes"),
    residentsMoved: wholeNumber(body.residentsMoved, 1000, "residentsMoved"),
  };
  if (body.issues !== undefined) {
    if (!Array.isArray(body.issues) || body.issues.length > MAX_ISSUES)
      throw new AppError("invalid_drill_log", 400, { field: "issues" });
    details.issues = body.issues.map((issue) => {
      const value = text(issue, MAX_ISSUE_LENGTH, "issues");
      if (!value) throw new AppError("invalid_drill_log", 400, { field: "issues" });
      return value;
    });
  }
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
};

const assertKind = (kind, { required }) => {
  if (kind === undefined && !required) return undefined;
  if (!Object.values(DrillKind).includes(kind))
    throw new AppError("invalid_drill_log", 400, { field: "kind" });
  return kind;
};

/** Log A Drill: records one that already happened, or adds the details to an evacuation that has ended. */
const logDrill = async ({ actor, organizationId, branchId, body = {}, now = new Date() }) => {
  if (body.evacuationEventId !== undefined) {
    if (!isValidObjectId(body.evacuationEventId))
      throw new AppError("evacuation_event_not_found", 404);
    const event = await EvacuationEvent.findById(body.evacuationEventId).lean();
    const branch = event
      ? await Branch.findOne({ _id: event.branchId, organizationId }).select("timezone").lean()
      : null;
    if (!branch) throw new AppError("evacuation_event_not_found", 404);
    assertMayManageStaff(await actorStanding(actor, organizationId), event.branchId);
    if (event.status !== EvacuationStatus.CLOSED)
      throw new AppError("evacuation_still_active", 409);

    const set = cleanDetails(body);
    const kind = assertKind(body.kind, { required: false });
    if (kind) set.drillKind = kind;
    if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);
    await EvacuationEvent.updateOne({ _id: event._id }, { $set: set });
    return presentHistory({ ...event, ...set }, branch.timezone || DEFAULT_TZ);
  }

  const siteId = await resolveLiveBranchId({ actor, organizationId, branchId });
  assertMayManageStaff(await actorStanding(actor, organizationId), siteId);
  const kind = assertKind(body.kind, { required: true });
  const startedAt = typeof body.startedAt === "string" ? new Date(body.startedAt) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime()) || startedAt > now)
    throw new AppError("invalid_drill_log", 400, { field: "startedAt" });
  const seconds = wholeNumber(body.durationSeconds, MAX_DURATION_SECONDS, "durationSeconds");
  if (seconds === undefined)
    throw new AppError("invalid_drill_log", 400, { field: "durationSeconds" });

  const created = await EvacuationEvent.create({
    branchId: siteId,
    type: kind === DrillKind.FALSE_ALARM ? EvacuationType.REAL : EvacuationType.MOCK,
    startedAt,
    closedAt: new Date(startedAt.getTime() + seconds * 1000),
    startedByUserId: actor._id,
    status: EvacuationStatus.CLOSED,
    drillKind: kind,
    loggedManually: true,
    ...cleanDetails(body),
  });
  const branch = await Branch.findById(siteId).select("timezone").lean();
  return presentHistory(
    created.toObject ? created.toObject() : created,
    branch?.timezone || DEFAULT_TZ,
  );
};

const setDrillKind = async ({ evacuationEventId, kind }) => {
  const drillKind = assertKind(kind, { required: false });
  if (drillKind) await EvacuationEvent.updateOne({ _id: evacuationEventId }, { $set: { drillKind } });
};

const assertDrillKind = (kind) => assertKind(kind, { required: false });

/** A real fire tells every app user of the site and the organisation's owners; a drill tells nobody. */
const alertAppUsers = async ({ actor, organizationId, event }) => {
  if (event.type !== EvacuationType.REAL) return 0;
  try {
    const receivers = await Membership.find({
      organizationId,
      status: ActiveInactiveStatus.ACTIVE,
      userId: { $ne: actor._id },
      $or: [
        { branchId: event.branchId },
        { role: { $in: [MembershipRole.OWNER, MembershipRole.SUPER_ADMIN] } },
      ],
    }).distinct("userId");
    if (!receivers.length) return 0;

    const title = "Fire Emergency";
    const meeting = event.branch?.assemblyPoint;
    const body = `Real fire at ${event.branch?.name || "your site"}.${meeting ? ` Assembly point: ${meeting}.` : " Evacuate now."}`;
    for (let i = 0; i < receivers.length; i += NOTIFY_CHUNK) {
      await NotificationExp.insertMany(
        receivers.slice(i, i + NOTIFY_CHUNK).map((receiverId) => ({
          type: NotificationTypes.EVACUATION_ALERT,
          subjectId: actor._id,
          objectId: event._id,
          objectType: "evacuation",
          receiverId,
          title,
          body,
        })),
        { ordered: false },
      );
    }
    sendUserNotifications({
      recipientIds: receivers,
      title,
      body,
      sender: actor._id,
      objectId: event._id,
      saveNotification: false,
      data: {
        type: NotificationTypes.EVACUATION_ALERT,
        objectType: "evacuation",
        objectId: String(event._id),
      },
    });
    return receivers.length;
  } catch (error) {
    // The evacuation has started; a failed alert must not undo or hide that.
    console.error("evacuation alert failed", error.message);
    return 0;
  }
};

const bannerOf = (data, timezone, now) => {
  const real = data.type === EvacuationType.REAL;
  const typeLabel = real ? "Real Fire" : "Drill";
  const sourceLabel = data.kioskId ? "Kiosk alarm button" : "Raised from a phone";
  const declaredAt = clock(data.startedAt, timezone);
  const elapsedMinutes = Math.max(Math.floor((now - new Date(data.startedAt)) / 60000), 0);
  return {
    title: real ? "Fire Emergency Active" : "Fire Drill Active",
    highlight: real ? "Fire Emergency" : "Fire Drill",
    status: { key: "live", label: "Live" },
    typeLabel,
    sourceLabel,
    declaredAt,
    elapsedMinutes,
    subtitle: `${typeLabel} - ${sourceLabel} - Declared ${declaredAt}`,
    elapsedLabel: `${elapsedMinutes} min elapsed.`,
  };
};

const rollcallCardOf = (stats) => {
  if (!stats) return null;
  const bar = (key, label) => {
    const row = stats.byKind?.[key] || {};
    const total = row.total || 0;
    const safe = row.safe || 0;
    return { key, label, safe, total, percent: total ? Math.round((safe / total) * 100) : 0 };
  };
  return {
    safe: stats.safe || 0,
    total: stats.total || 0,
    label: `${stats.safe || 0} / ${stats.total || 0} Safe`,
    rows: [
      bar(EvacPersonKind.STAFF, "Staff"),
      bar(EvacPersonKind.RESIDENT, "Residents"),
      bar(EvacPersonKind.VISITOR, "Visitors"),
    ],
  };
};

const familiesCardOf = (data) => {
  const alert = data.familyAlert;
  if (!alert) return null;
  const status = alert.status || FamilyAlertStatus.NOT_SENT;
  const labels = { notSent: "Not Sent", alertSent: "Alert Sent", allClearSent: "All Clear Sent" };
  return {
    status: { key: status, label: labels[status] || status },
    canAlert:
      data.type === EvacuationType.REAL &&
      Boolean(alert.offsiteAlertsEnabled) &&
      status === FamilyAlertStatus.NOT_SENT,
    familiesToNotify: alert.familiesToNotify ?? 0,
  };
};

const TAGS = {
  safe: "Safe",
  missing: "Missing",
  unknown: "Unknown",
  offSite: "Off Site",
};

const rowDetails = async ({ rows, branchId, startedAt }) => {
  const idsOf = (...kinds) => rows.filter((row) => kinds.includes(row.personKind)).map((row) => row.personId);
  const visitorIds = idsOf(EvacPersonKind.VISITOR, EvacPersonKind.CONTRACTOR);
  const residentIds = idsOf(EvacPersonKind.RESIDENT);
  const staffIds = idsOf(EvacPersonKind.STAFF);
  const dayStart = moment.utc(startedAt).startOf("day").toDate();

  const [sessions, peeps, days] = await Promise.all([
    visitorIds.length
      ? VisitSession.find({ branchId, externalPersonId: { $in: visitorIds } })
          .sort({ checkInAt: -1 })
          .select("externalPersonId invitationId")
          .lean()
      : [],
    residentIds.length
      ? PeepRecord.find({ residentId: { $in: residentIds } })
          .select("residentId assistanceRequired")
          .lean()
      : [],
    staffIds.length
      ? AttendanceDay.find({ staffId: { $in: staffIds }, workDate: dayStart })
          .select("staffId clockInAt")
          .lean()
      : [],
  ]);

  const latest = new Map();
  sessions.forEach((session) => {
    const key = String(session.externalPersonId);
    if (!latest.has(key)) latest.set(key, session);
  });
  const invitationIds = [...latest.values()].map((session) => session.invitationId).filter(Boolean);
  const familyVisits = invitationIds.length
    ? await FamilyVisit.find({ invitationId: { $in: invitationIds } })
        .select("invitationId partySize")
        .lean()
    : [];

  return {
    sessionOf: latest,
    familyVisitOf: new Map(familyVisits.map((visit) => [String(visit.invitationId), visit])),
    assistanceOf: new Map(peeps.map((peep) => [String(peep.residentId), peep.assistanceRequired || ""])),
    clockInOf: new Map(days.map((day) => [String(day.staffId), day.clockInAt])),
  };
};

const presentRow = (row, details, timezone) => {
  const id = String(row.personId);
  let title = row.name;
  let parts;
  let guests = 0;
  if (row.personKind === EvacPersonKind.STAFF) {
    const clockIn = details.clockInOf.get(id);
    const shift = clockIn
      ? hourKind(clockIn, timezone) === DrillKind.NIGHT
        ? "Nights"
        : "Days"
      : row.jobTitle;
    const seen = row.lastSeenLabel || row.locationLabel;
    parts = ["Staff", shift, seen ? `Last Seen ${seen}` : ""];
  } else if (row.personKind === EvacPersonKind.RESIDENT) {
    parts = [
      "Resident",
      row.roomNumber ? `Room ${row.roomNumber}` : "",
      details.assistanceOf.get(id),
    ];
  } else {
    const session = details.sessionOf.get(id);
    const familyVisit = session?.invitationId
      ? details.familyVisitOf.get(String(session.invitationId))
      : null;
    guests = Math.max((familyVisit?.partySize || 1) - 1, 0);
    if (guests) title = `${row.name} + ${plural(guests, "Guest")}`;
    const kind = familyVisit
      ? "Family Visit Pass"
      : row.personKind === EvacPersonKind.CONTRACTOR
        ? "Contractor"
        : "Visitor";
    parts = [kind, row.signedInAt ? `Signed In ${clock(row.signedInAt, timezone)}` : ""];
  }
  return {
    ...row,
    guests,
    title,
    subtitle: parts.filter(Boolean).join(" - "),
    tag: { key: row.status, label: TAGS[row.status] || row.status },
  };
};

/** Adds what the Evacuation screen prints to the active evacuation; nothing already there is changed. */
const presentActive = async ({ data, now = new Date() }) => {
  const timezone = data.branch?.timezone || DEFAULT_TZ;
  const result = { ...data, banner: bannerOf(data, timezone, now) };
  if (!data.unaccounted) return result;

  const details = await rowDetails({
    rows: data.unaccounted,
    branchId: toObjectId(data.branchId),
    startedAt: data.startedAt,
  });
  const count = (data.rollcallStats?.missing || 0) + (data.rollcallStats?.unknown || 0);
  return {
    ...result,
    rollcallCard: rollcallCardOf(data.rollcallStats),
    familiesCard: familiesCardOf(data),
    notAccountedFor: { title: "Not Yet Accounted For", count },
    unaccounted: data.unaccounted.map((row) => presentRow(row, details, timezone)),
  };
};

module.exports = {
  getFireDrills,
  logDrill,
  assertDrillKind,
  setDrillKind,
  alertAppUsers,
  presentActive,
};
