const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { KioskActivity } = require("@models/KioskActivity");
const { KioskActivityType } = require("@models/domainEnums");
const kioskService = require("./kioskService");

const DEFAULT_TZ = "Europe/London";

const agoLabel = (value, now) => {
  const seconds = Math.max(Math.floor((now - new Date(value)) / 1000), 0);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

// Today shows the time alone; an older moment also says which day.
const timeLabel = (value, timezone, now) => {
  const when = moment(value).tz(timezone);
  return when.isSame(moment(now).tz(timezone), "day")
    ? when.format("HH:mm")
    : when.format("D MMM HH:mm");
};

const shortName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts.join("");
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
};

const activityByKiosk = async ({ kiosks, zoneOf, now }) => {
  const ids = kiosks.map((kiosk) => kiosk._id);
  if (!ids.length) return { lastOf: new Map(), countOf: new Map() };

  const [latest, counts] = await Promise.all([
    KioskActivity.aggregate([
      { $match: { kioskId: { $in: ids }, type: KioskActivityType.CHECK_IN } },
      { $sort: { occurredAt: -1 } },
      {
        $group: {
          _id: "$kioskId",
          occurredAt: { $first: "$occurredAt" },
          name: { $first: "$name" },
        },
      },
    ]),
    Promise.all(
      kiosks.map(async (kiosk) => [
        String(kiosk._id),
        await KioskActivity.countDocuments({
          kioskId: kiosk._id,
          occurredAt: { $gte: moment(now).tz(zoneOf(kiosk)).startOf("day").toDate() },
        }),
      ]),
    ),
  ]);

  return {
    lastOf: new Map(latest.map((row) => [String(row._id), row])),
    countOf: new Map(counts),
  };
};

const presentKiosk = ({ kiosk, last, eventsToday, timezone, now }) => {
  const online = kiosk.presence === "online";
  const heartbeatAt = kiosk.lastHeartbeatAt || null;
  // Check-ins made before activity was recorded leave only the kiosk's own timestamp.
  const checkInAt = last?.occurredAt || kiosk.lastCheckInAt || null;
  const who = shortName(last?.name);

  const lastCheckInLine = checkInAt
    ? [`Last Check-In ${timeLabel(checkInAt, timezone, now)}`, who].filter(Boolean).join(" - ")
    : "No Check-Ins Yet";
  const heartbeatLine = heartbeatAt ? `Heartbeat ${agoLabel(heartbeatAt, now)} Ago` : "No Heartbeat Yet";
  const lastSeenLine = heartbeatAt
    ? `Last Seen ${timeLabel(heartbeatAt, timezone, now)} - ${agoLabel(heartbeatAt, now)} ago`
    : "Never Seen";
  const eventsLine = `${eventsToday} ${eventsToday === 1 ? "Event" : "Events"} Today`;

  return {
    _id: kiosk._id,
    name: kiosk.locationLabel || kiosk.receptionIdentifier || "Kiosk",
    status: online ? { key: "online", label: "Online" } : { key: "offline", label: "Offline" },
    lines: online
      ? [lastCheckInLine, `${heartbeatLine} - ${eventsLine}`]
      : [lastSeenLine, lastCheckInLine],
    lastCheckIn: checkInAt
      ? { at: checkInAt, time: timeLabel(checkInAt, timezone, now), name: last?.name || "" }
      : null,
    lastHeartbeatAt: heartbeatAt,
    eventsToday,
    kioskMode: kiosk.kioskMode || null,
    setupStatus: kiosk.setupStatus || null,
    branch: kiosk.branch ? { _id: kiosk.branch._id, name: kiosk.branch.name } : null,
  };
};

const getKiosksScreen = async ({ actor, organizationId, branchId, page, limit, skip, now = new Date() }) => {
  const list = await kioskService.listKiosksForAdmin({
    actor,
    organizationId,
    branchId,
    page,
    limit,
    skip,
  });
  const branches = list.data.length
    ? await Branch.find({ _id: { $in: list.data.map((kiosk) => kiosk.branchId) } })
        .select("timezone")
        .lean()
    : [];
  const zones = new Map(branches.map((branch) => [String(branch._id), branch.timezone]));
  const zoneOf = (kiosk) => zones.get(String(kiosk.branchId)) || DEFAULT_TZ;
  const { lastOf, countOf } = await activityByKiosk({ kiosks: list.data, zoneOf, now });

  return {
    data: list.data.map((kiosk) =>
      presentKiosk({
        kiosk,
        last: lastOf.get(String(kiosk._id)),
        eventsToday: countOf.get(String(kiosk._id)) || 0,
        timezone: zoneOf(kiosk),
        now,
      }),
    ),
    meta: list.meta,
  };
};

module.exports = { getKiosksScreen };
