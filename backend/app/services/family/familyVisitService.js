const moment = require("moment-timezone");
const { FamilyVisit } = require("@models/FamilyVisit");
const { Resident } = require("@models/Resident");
const {
  FamilyVisitStatus,
  FamilyVisitSource,
  FamilyVisitReply,
} = require("@models/domainEnums");
const { facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, isValidObjectId } = require("./familyPipeline");
const {
  timesOf,
  loadRules,
  visitingNotice,
  visitWindow,
  assertDayInRange,
  cleanText,
  isText,
  TIME,
  DATE,
} = require("./familyVisitRules");
const {
  issueInvitation,
  cancelInvitation,
} = require("./familyVisitInvitation");
const {
  notifyVisitRequested,
  notifyVisitReply,
  notifyVisitCancelledByFamily,
} = require("./familyVisitNotifications");

const VisitTab = { UPCOMING: "upcoming", PAST: "past" };
const VisitAction = {
  CANCEL: "cancel",
  GOING: FamilyVisitReply.GOING,
  CANT_MAKE_IT: FamilyVisitReply.CANT_MAKE_IT,
};

const MAX_OPEN_REQUESTS = 5;
const MAX_NOTE_LENGTH = 500;
const DECIDED = [FamilyVisitStatus.DECLINED, FamilyVisitStatus.CANCELLED];
const INVITED_STATE = "invited";

const baseMatch = ({ link, userId }) => ({
  organizationId: toObjectId(link.organizationId),
  residentId: toObjectId(link.residentId),
  $or: [
    { requestedBy: toObjectId(userId) },
    { source: FamilyVisitSource.HOME },
  ],
});

/**
 * `state` is what this person sees: a request's own status, or for a home invitation their own answer
 * (invited until they reply). `isPast` covers visits that ended and ones that will not happen.
 */
const stateStages = ({ userId, now }) => [
  {
    $addFields: {
      myReply: {
        $arrayElemAt: [
          {
            $filter: {
              input: "$replies",
              as: "reply",
              cond: { $eq: ["$$reply.userId", toObjectId(userId)] },
            },
          },
          0,
        ],
      },
    },
  },
  {
    $addFields: {
      state: {
        $cond: [
          { $eq: ["$source", FamilyVisitSource.HOME] },
          {
            $cond: [
              { $eq: ["$status", FamilyVisitStatus.CANCELLED] },
              FamilyVisitStatus.CANCELLED,
              { $ifNull: ["$myReply.response", INVITED_STATE] },
            ],
          },
          "$status",
        ],
      },
    },
  },
  {
    $addFields: {
      isPast: {
        $or: [{ $lt: ["$endAt", now] }, { $in: ["$state", DECIDED] }],
      },
    },
  },
];

const itemStage = {
  $project: {
    _id: 0,
    id: "$_id",
    source: 1,
    fromTheHome: { $eq: ["$source", FamilyVisitSource.HOME] },
    status: "$state",
    startAt: 1,
    endAt: 1,
    partySize: 1,
    note: 1,
    decisionNote: 1,
    canCancel: {
      $and: [
        { $eq: ["$source", FamilyVisitSource.FAMILY] },
        {
          $in: [
            "$state",
            [FamilyVisitStatus.REQUESTED, FamilyVisitStatus.CONFIRMED],
          ],
        },
        { $eq: ["$isPast", false] },
      ],
    },
    canReply: {
      $and: [
        { $eq: ["$source", FamilyVisitSource.HOME] },
        { $ne: ["$status", FamilyVisitStatus.CANCELLED] },
        { $eq: ["$isPast", false] },
      ],
    },
    hasPass: {
      $and: [
        {
          $in: [
            "$state",
            [FamilyVisitStatus.CONFIRMED, FamilyVisitReply.GOING],
          ],
        },
        { $eq: ["$isPast", false] },
      ],
    },
  },
};

const findItem = async ({ link, userId, visitId, now }) => {
  const [item] = await FamilyVisit.aggregate([
    { $match: { ...baseMatch({ link, userId }), _id: toObjectId(visitId) } },
    ...stateStages({ userId, now }),
    itemStage,
  ]);
  return item || null;
};

const requireItem = async (args) => {
  if (!isValidObjectId(args.visitId))
    throw new AppError("visit_not_found", 404);
  const item = await findItem(args);
  if (!item) throw new AppError("visit_not_found", 404);
  return item;
};

/** My Visits: upcoming or past, with the home's invitations and a notice when visiting is paused. */
const listVisits = async ({
  link,
  userId,
  tab = VisitTab.UPCOMING,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  if (!Object.values(VisitTab).includes(tab))
    throw new AppError("invalid_visit_tab", 400);

  const past = tab === VisitTab.PAST;
  const tabMatch = { $match: { isPast: past } };
  const [rules, [result]] = await Promise.all([
    loadRules(link.branchId),
    FamilyVisit.aggregate([
      { $match: baseMatch({ link, userId }) },
      ...stateStages({ userId, now }),
      {
        $facet: {
          data: [
            tabMatch,
            { $sort: { startAt: past ? -1 : 1, _id: 1 } },
            { $skip: skip },
            { $limit: limit },
            itemStage,
          ],
          total: [tabMatch, { $count: "count" }],
          allCount: [{ $count: "count" }],
          upcoming: [{ $match: { isPast: false } }, { $count: "count" }],
          past: [{ $match: { isPast: true } }, { $count: "count" }],
        },
      },
    ]),
  ]);

  return {
    data: result.data,
    meta: {
      ...generateMeta(page, limit, facetCount(result.total)),
      counts: {
        all: facetCount(result.allCount),
        upcoming: facetCount(result.upcoming),
        past: facetCount(result.past),
      },
      visiting: visitingNotice(rules),
    },
  };
};

/** Your Next Visit on the Home tab: the soonest visit that is confirmed or that I said I would attend. */
const getNextVisit = async ({ link, userId, now = new Date() }) => {
  const [rules, [visit]] = await Promise.all([
    loadRules(link.branchId),
    FamilyVisit.aggregate([
      { $match: baseMatch({ link, userId }) },
      ...stateStages({ userId, now }),
      {
        $match: {
          isPast: false,
          state: { $in: [FamilyVisitStatus.CONFIRMED, FamilyVisitReply.GOING] },
        },
      },
      { $sort: { startAt: 1, _id: 1 } },
      { $limit: 1 },
      itemStage,
    ]),
  ]);
  return { visit: visit || null, visiting: visitingNotice(rules) };
};

/** Book A Visit: the days and start times the site offers. */
const getOptions = async ({ link, now = new Date() }) => {
  const rules = await loadRules(link.branchId);
  const local = moment.tz(now, rules.timezone);
  const times = timesOf(rules);

  const days = [];
  for (let offset = 0; offset <= rules.daysAhead; offset += 1) {
    const day = local.clone().startOf("day").add(offset, "days");
    const open = times.some((time) => {
      const [hours, minutes] = time.split(":").map(Number);
      return day.clone().hour(hours).minute(minutes).isAfter(local);
    });
    if (open)
      days.push({ date: day.format(DATE), weekday: day.format("dddd") });
  }

  return {
    visiting: visitingNotice(rules),
    timezone: rules.timezone,
    days,
    visitingHours: rules.visitingHours,
    protectedTimes: rules.protectedTimes.map(({ start, end, label }) => ({ start, end, label: label || "" })),
    maxPartySize: rules.maxPartySize,
  };
};

const readPartySize = (value, max) => {
  const size =
    typeof value === "string" && /^\d{1,3}$/.test(value)
      ? Number(value)
      : value;
  if (!Number.isInteger(size) || size < 1 || size > max)
    throw new AppError("invalid_party_size", 400, { max });
  return size;
};

/** Asks the home for a visit. It stays a request until staff confirm it. */
const requestVisit = async ({ link, user, body = {}, now = new Date() }) => {
  const rules = await loadRules(link.branchId);
  if (rules.paused)
    throw new AppError("visiting_paused", 403, {
      reason: rules.pausedReason,
    });

  const time = isText(body.time) && TIME.test(body.time) ? body.time : null;
  if (!time || !timesOf(rules, { includeProtected: true }).includes(time))
    throw new AppError("invalid_visit_time", 400);
  if (!timesOf(rules).includes(time)) throw new AppError("visit_protected_time", 400);

  const { startAt, endAt } = visitWindow({
    date: body.date,
    start: time,
    end: rules.visitingHours.end,
    timezone: rules.timezone,
  });
  assertDayInRange({ date: body.date, rules, now });
  if (startAt <= now) throw new AppError("visit_in_past", 400);

  const partySize = readPartySize(body.totalPeople, rules.maxPartySize);
  const note = cleanText(body.note, { field: "note", max: MAX_NOTE_LENGTH });

  const mineOpen = {
    requestedBy: user._id,
    residentId: toObjectId(link.residentId),
    source: FamilyVisitSource.FAMILY,
  };
  const duplicate = await FamilyVisit.exists({
    ...mineOpen,
    startAt,
    status: {
      $in: [FamilyVisitStatus.REQUESTED, FamilyVisitStatus.CONFIRMED],
    },
  });
  if (duplicate) throw new AppError("visit_already_requested", 409);

  const waiting = await FamilyVisit.countDocuments({
    ...mineOpen,
    status: FamilyVisitStatus.REQUESTED,
    endAt: { $gt: now },
  });
  if (waiting >= MAX_OPEN_REQUESTS)
    throw new AppError("too_many_visit_requests", 429, {
      max: MAX_OPEN_REQUESTS,
    });

  const visit = await FamilyVisit.create({
    organizationId: link.organizationId,
    branchId: link.branchId,
    residentId: link.residentId,
    source: FamilyVisitSource.FAMILY,
    requestedBy: user._id,
    startAt,
    endAt,
    partySize,
    note,
    status: FamilyVisitStatus.REQUESTED,
  });

  await notifyVisitRequested({ visit, requesterName: user.name });

  return requireItem({
    link,
    userId: user._id,
    visitId: visit._id,
    now,
  });
};

const cancelMine = async ({ link, user, visitId, now }) => {
  const claimed = await FamilyVisit.findOneAndUpdate(
    {
      _id: toObjectId(visitId),
      residentId: toObjectId(link.residentId),
      requestedBy: user._id,
      source: FamilyVisitSource.FAMILY,
      status: {
        $in: [FamilyVisitStatus.REQUESTED, FamilyVisitStatus.CONFIRMED],
      },
      endAt: { $gt: now },
    },
    { $set: { status: FamilyVisitStatus.CANCELLED } },
    {
      new: false,
      projection: {
        invitationId: 1,
        organizationId: 1,
        branchId: 1,
        residentId: 1,
        startAt: 1,
        endAt: 1,
      },
    },
  ).lean();
  if (!claimed) throw new AppError("visit_not_cancellable", 409);

  await cancelInvitation({
    invitationId: claimed.invitationId,
    userId: user._id,
    now,
  });
  await notifyVisitCancelledByFamily({ visit: claimed, user });
};

const saveReply = async ({ visitId, userId, response, now }) => {
  const open = {
    _id: toObjectId(visitId),
    source: FamilyVisitSource.HOME,
    status: FamilyVisitStatus.INVITED,
    endAt: { $gt: now },
  };
  const update = () =>
    FamilyVisit.updateOne(
      { ...open, "replies.userId": userId },
      {
        $set: {
          "replies.$.response": response,
          "replies.$.respondedAt": now,
        },
      },
    );

  if ((await update()).matchedCount) return true;
  const pushed = await FamilyVisit.updateOne(
    { ...open, "replies.userId": { $ne: userId } },
    {
      $push: {
        replies: { userId, response, respondedAt: now, invitationId: null },
      },
    },
  );
  return pushed.matchedCount ? true : (await update()).matchedCount > 0;
};

const replyToInvitation = async ({ link, user, visitId, response, now }) => {
  const visit = await FamilyVisit.findOne({
    _id: toObjectId(visitId),
    residentId: toObjectId(link.residentId),
    source: FamilyVisitSource.HOME,
  })
    .select("replies")
    .lean();
  if (!visit) throw new AppError("visit_not_found", 404);

  const previous = (visit.replies || []).find(
    (entry) => String(entry.userId) === String(user._id),
  )?.response;
  if (!(await saveReply({ visitId, userId: user._id, response, now })))
    throw new AppError("visit_not_replyable", 409);
  if (previous !== response) await notifyVisitReply({ visitId, user, response });

  const reply = (
    await FamilyVisit.findById(visitId).select("replies").lean()
  ).replies.find((entry) => String(entry.userId) === String(user._id));

  if (response === FamilyVisitReply.CANT_MAKE_IT) {
    if (reply?.invitationId) {
      await cancelInvitation({
        invitationId: reply.invitationId,
        userId: user._id,
        now,
      });
      await FamilyVisit.updateOne(
        { _id: toObjectId(visitId), "replies.userId": user._id },
        { $set: { "replies.$.invitationId": null } },
      );
    }
    return;
  }
  if (reply?.invitationId) return;

  const [full, resident] = await Promise.all([
    FamilyVisit.findById(visitId).lean(),
    Resident.findById(link.residentId).select("name").lean(),
  ]);
  const invitation = await issueInvitation({
    visit: full,
    visitorName: user.name,
    visitorEmail: user.email,
    residentName: resident?.name || "",
    createdBy: user._id,
  });
  const attached = await FamilyVisit.updateOne(
    {
      _id: toObjectId(visitId),
      replies: { $elemMatch: { userId: user._id, invitationId: null } },
    },
    { $set: { "replies.$.invitationId": invitation._id } },
  );
  if (!attached.modifiedCount)
    await cancelInvitation({
      invitationId: invitation._id,
      userId: user._id,
      now,
    });
};

/** The caller's own link to the resident this visit is about; a visit of anyone else's is simply not found. */
const linkOfVisit = async ({ links, visitId }) => {
  if (!isValidObjectId(visitId)) throw new AppError("visit_not_found", 404);
  const visit = await FamilyVisit.findById(visitId).select("residentId").lean();
  const link = visit
    ? links.find(
        (entry) => String(entry.residentId) === String(visit.residentId),
      )
    : null;
  if (!link) throw new AppError("visit_not_found", 404);
  return link;
};

/** One route for what a person does with a visit: cancel their request, or answer the home's invitation. */
const updateVisit = async ({
  links,
  user,
  visitId,
  action,
  now = new Date(),
}) => {
  const link = await linkOfVisit({ links, visitId });
  await requireItem({ link, userId: user._id, visitId, now });

  if (action === VisitAction.CANCEL) {
    await cancelMine({ link, user, visitId, now });
  } else {
    await replyToInvitation({
      link,
      user,
      visitId,
      response: action,
      now,
    });
  }

  return requireItem({ link, userId: user._id, visitId, now });
};

module.exports = {
  VisitTab,
  VisitAction,
  MAX_OPEN_REQUESTS,
  listVisits,
  getNextVisit,
  getOptions,
  requestVisit,
  updateVisit,
};
