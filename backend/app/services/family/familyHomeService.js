const { FamilyMember } = require("@models/FamilyMember");
const { NotificationExp } = require("@models/Notifications");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const moment = require("moment-timezone");
const { toObjectId, isValidObjectId } = require("./familyPipeline");
const { resolveFamilyResidents } = require("./familyAccessService");
const { getNextVisit } = require("./familyVisitService");
const { nextGazette } = require("./familyGazetteService");
const { unreadTotal } = require("./familyMessageService");
const { namesOf } = require("./familyNotify");

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
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
};

const pendingRequestsOf = async ({ residentId }) => {
  const [row] = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        status: FamilyMemberStatus.PENDING,
      },
    },
    { $count: "count" },
  ]);
  return row?.count ?? 0;
};

const noticesOf = ({ visiting, pendingRequests }) => [
  ...(visiting.paused
    ? [
        {
          type: "visitingPaused",
          title: "Visiting is paused",
          message: visiting.reason || "Visits can't be booked right now.",
        },
      ]
    : []),
  ...(pendingRequests
    ? [
        {
          type: "joinRequests",
          title: "Join requests to review",
          message: `${pendingRequests} ${pendingRequests === 1 ? "person has" : "people have"} asked to join the family.`,
          count: pendingRequests,
        },
      ]
    : []),
];

/** The Home Family tab in one call, for the resident being viewed (the first one when none is named). */
const getHome = async ({ user, residentId, now = new Date() }) => {
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
  const [nextVisit, gazette, notifications, messages, pendingRequests, names] =
    await Promise.all([
      getNextVisit({ link, userId: user._id, now }),
      nextGazette({ link, now }),
      NotificationExp.countDocuments({
        receiverId: user._id,
        isRead: false,
        isDeleted: { $ne: true },
      }),
      unreadTotal(user._id),
      active.isNextOfKin ? pendingRequestsOf(active) : 0,
      namesOf(active),
    ]);

  return {
    greeting: greetingOf({ name: user.name, timezone: names.timezone, now }),
    homeName: active.homeName,
    resident: active,
    residents,
    nextVisit: nextVisit.visit,
    visiting: nextVisit.visiting,
    gazette,
    notices: noticesOf({
      visiting: nextVisit.visiting,
      pendingRequests,
    }),
    unread: { notifications, messages },
  };
};

module.exports = { getHome };
