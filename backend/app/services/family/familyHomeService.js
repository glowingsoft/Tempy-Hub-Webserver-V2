const { NotificationExp } = require("@models/Notifications");
const { AppError } = require("@services/_errors/AppError");
const moment = require("moment-timezone");
const { isValidObjectId } = require("./familyPipeline");
const { resolveFamilyResidents } = require("./familyAccessService");
const { getNextVisit } = require("./familyVisitService");
const { nextGazette, listGazettes } = require("./familyGazetteService");
const { unreadTotal } = require("./familyMessageService");
const { getCurrentHandover } = require("./familyHandoverService");
const { namesOf } = require("./familyNotify");
const { listTimeline } = require("./familyTimelineService");
const { listWall } = require("./familyWallService");

const HomeTab = { FAMILY: "family", WALL: "wall" };
const HOME_TABS = Object.values(HomeTab);

/**
 * family: this resident's timeline: the approved family uploads and the home posts tagged to the resident.
 * wall: every post this site's families may see, as on the Community Wall.
 */
const feedOf = async ({ tab, active, residents, userId, paging }) => {
  const feed =
    tab === HomeTab.FAMILY
      ? await listTimeline({ link: active, links: residents, userId, ...paging })
      : await listWall({ link: active, links: residents, userId, ...paging });
  return { tab, items: feed.data, meta: feed.meta };
};

const GAZETTE_FEED_TYPE = "gazette";

const withGazette = ({ feed, gazette }) => {
  if (!feed || feed.tab !== HomeTab.WALL || !gazette?.printedAt) return feed;

  const printed = new Date(gazette.printedAt).getTime();
  const card = { type: GAZETTE_FEED_TYPE, ...gazette };
  const items = [...feed.items];
  const at = items.findIndex(
    (post) => !post.isPinned && new Date(post.createdAt).getTime() <= printed,
  );

  if (at !== -1) items.splice(at, 0, card);
  else if (feed.meta.currentPage >= feed.meta.totalPages) items.push(card);
  else return feed;
  return { ...feed, items };
};

const latestGazetteOf = async ({ link }) => {
  const { data } = await listGazettes({ link, page: 1, limit: 1, skip: 0 });
  return data?.[0] || null;
};

const MORNING_UNTIL = 12;
const AFTERNOON_UNTIL = 18;

const greetingOf = ({ name, timezone, now }) => {
  const hour = moment.tz(now, timezone).hour();
  const part =
    hour < MORNING_UNTIL
      ? "Good morning"
      : hour < AFTERNOON_UNTIL
        ? "Good afternoon"
        : "Good evening";
  const first = String(name || "")
    .trim()
    .split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
};

/** The Home Family tab in one call, for the resident being viewed (the first one when none is named). */
const getHome = async ({ user, residentId, tab, paging, now = new Date() }) => {
  if (tab !== undefined && !HOME_TABS.includes(tab))
    throw new AppError("invalid_home_tab", 400);
  if (
    residentId !== undefined &&
    (typeof residentId !== "string" || !isValidObjectId(residentId))
  )
    throw new AppError("invalid_resident_id", 400);

  const residents = await resolveFamilyResidents(user._id, {
    activeResidentId: residentId,
  });
  if (!residents.length) throw new AppError("family_profile_not_found", 404);

  const active = residents.find((row) => row.isActive);
  if (residentId !== undefined && String(active.residentId) !== residentId)
    throw new AppError("resident_not_found", 404);

  const link = {
    organizationId: active.organizationId,
    branchId: active.branchId,
    residentId: active.residentId,
  };
  const [
    nextVisit,
    gazette,
    latestGazette,
    notifications,
    messages,
    names,
    handover,
    wallOrTimeline,
  ] = await Promise.all([
    getNextVisit({ link, userId: user._id, now }),
    nextGazette({ link, now }),
    latestGazetteOf({ link }),
    NotificationExp.countDocuments({
      receiverId: user._id,
      isRead: false,
      isDeleted: { $ne: true },
    }),
    unreadTotal(user._id),
    namesOf(active),
    getCurrentHandover({
      userId: user._id,
      residentId: String(active.residentId),
    }),
    tab
      ? feedOf({ tab, active, residents, userId: user._id, paging })
      : undefined,
  ]);
  const feed = withGazette({ feed: wallOrTimeline, gazette: latestGazette });

  return {
    greeting: greetingOf({ name: user.name, timezone: names.timezone, now }),
    homeName: active.homeName,
    resident: active,
    residents,
    nextVisit: nextVisit.visit,
    visiting: nextVisit.visiting,
    gazette,
    unread: { notifications, messages },
    handover,
    // Only present when ?tab= is sent, so the plain home response is unchanged.
    ...(feed ? { feed } : {}),
  };
};

module.exports = { getHome };
