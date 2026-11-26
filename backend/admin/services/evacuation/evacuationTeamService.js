/**
 * "Drill in progress" for a line manager: their team's roll call for one active
 * evacuation, and Mark safe on behalf of a team member.
 * Team = active direct reports and supervisees on the evacuation's site (lineTeamMatch).
 * Statuses live in EvacCheck, so the site manager's roll call and counts stay in step.
 */
const mongoose = require("mongoose");
const { AppError } = require("@services/_errors/AppError");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { EvacCheck } = require("@models/EvacCheck");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { Department } = require("@models/Department");
const {
  MembershipRole,
  StaffProfileStatus,
  EvacPersonKind,
  EvacCheckStatus,
  EvacuationStatus,
} = require("@models/domainEnums");
const { generateMeta } = require("@utils/responseUtil");
const { facetCount } = require("@utils/paginate");
const {
  actorStanding,
  lineTeamMatch,
} = require("@adminServices/staff/staffAccess");

const idOf = (value, errorKey, status = 400) => {
  const text = String(value ?? "").trim();
  if (!/^[a-f\d]{24}$/i.test(text)) throw new AppError(errorKey, status);
  return new mongoose.Types.ObjectId(text);
};

/** The event, the caller's staff profile and the Mongo match for their team, in one round. */
const loadContext = async ({ actor, organizationId, evacuationEventId }) => {
  const eventId = idOf(evacuationEventId, "evacuation_event_not_found", 404);
  const orgId = idOf(organizationId, "invalid_organization_id");

  const [standing, event, manager] = await Promise.all([
    actorStanding(actor, organizationId),
    EvacuationEvent.findById(eventId).select("branchId status type startedAt").lean(),
    StaffProfile.findOne({ userId: actor._id, organizationId: orgId })
      .select("_id")
      .lean(),
  ]);

  if (standing.role !== MembershipRole.LINE_MANAGER) {
    throw new AppError("insufficient_role", 403);
  }
  if (!event) throw new AppError("evacuation_event_not_found", 404);
  // The line manager's site is in this organization, so matching it also scopes the event.
  if (!standing.branchId || String(standing.branchId) !== String(event.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }
  if (!manager) throw new AppError("staff_profile_not_found", 403);

  return {
    event,
    teamMatch: {
      organizationId: orgId,
      branchId: event.branchId,
      status: StaffProfileStatus.ACTIVE,
      ...lineTeamMatch(manager._id),
    },
  };
};

const checkLookup = (eventId) => ({
  $lookup: {
    from: EvacCheck.collection.name,
    let: { personId: "$_id" },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ["$evacuationEventId", eventId] },
              { $eq: ["$personKind", EvacPersonKind.STAFF] },
              { $eq: ["$personId", "$$personId"] },
            ],
          },
        },
      },
      { $project: { status: 1, markedAt: 1, markedByUserId: 1 } },
      { $limit: 1 },
    ],
    as: "check",
  },
});

const userName = (localField, as) => ({
  $lookup: {
    from: User.collection.name,
    localField,
    foreignField: "_id",
    pipeline: [{ $project: { name: 1, profileIcon: 1 } }],
    as,
  },
});

/** Only the page's rows get departments and the "marked by" name. */
const rowStages = [
  {
    $lookup: {
      from: Department.collection.name,
      localField: "departmentIds",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1 } }],
      as: "departments",
    },
  },
  userName("check.markedByUserId", "markedByUser"),
  {
    $project: {
      _id: 0,
      staffId: "$_id",
      name: 1,
      photoUrl: 1,
      department: { $ifNull: [{ $arrayElemAt: ["$departments.name", 0] }, ""] },
      // No roll call row: the person was not clocked in when the drill started.
      onSite: { $gt: [{ $size: "$check" }, 0] },
      status: {
        $ifNull: [{ $arrayElemAt: ["$check.status", 0] }, EvacCheckStatus.UNKNOWN],
      },
      markedAt: { $ifNull: [{ $arrayElemAt: ["$check.markedAt", 0] }, null] },
      markedBy: {
        $cond: [
          { $gt: [{ $size: "$markedByUser" }, 0] },
          {
            _id: { $arrayElemAt: ["$markedByUser._id", 0] },
            name: { $arrayElemAt: ["$markedByUser.name", 0] },
          },
          null,
        ],
      },
    },
  },
];

const listTeamRollcall = async ({
  actor,
  organizationId,
  evacuationEventId,
  page,
  limit,
  skip,
}) => {
  const { event, teamMatch } = await loadContext({
    actor,
    organizationId,
    evacuationEventId,
  });

  const [result] = await StaffProfile.aggregate([
    { $match: teamMatch },
    checkLookup(event._id),
    userName("userId", "user"),
    {
      $addFields: {
        name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
        photoUrl: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$photoUrl", ""] } }, 0] },
            "$photoUrl",
            { $ifNull: [{ $arrayElemAt: ["$user.profileIcon", 0] }, ""] },
          ],
        },
      },
    },
    {
      $facet: {
        data: [
          { $sort: { name: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          ...rowStages,
        ],
        totalCount: [{ $count: "count" }],
        summary: [
          {
            $group: {
              _id: null,
              safe: {
                $sum: {
                  $cond: [
                    { $eq: [{ $arrayElemAt: ["$check.status", 0] }, EvacCheckStatus.SAFE] },
                    1,
                    0,
                  ],
                },
              },
              onSite: { $sum: { $cond: [{ $gt: [{ $size: "$check" }, 0] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ]);

  const total = facetCount(result?.totalCount);
  const summary = result?.summary?.[0] || {};
  return {
    data: result?.data || [],
    meta: {
      ...generateMeta(page, limit, total),
      evacuation: {
        _id: event._id,
        type: event.type,
        status: event.status,
        startedAt: event.startedAt,
      },
      summary: { safe: summary.safe || 0, onSite: summary.onSite || 0, total },
    },
  };
};

/** Mark safe on behalf of a team member. Pressing it again changes nothing. */
const markTeamMemberSafe = async ({
  actor,
  organizationId,
  evacuationEventId,
  staffId,
}) => {
  const staffOid = idOf(staffId, "invalid_staff_profile_id");
  const { event, teamMatch } = await loadContext({
    actor,
    organizationId,
    evacuationEventId,
  });
  if (event.status !== EvacuationStatus.ACTIVE) {
    throw new AppError("evacuation_not_active", 409);
  }

  const key = {
    evacuationEventId: event._id,
    personKind: EvacPersonKind.STAFF,
    personId: staffOid,
  };
  const [member, existing] = await Promise.all([
    StaffProfile.exists({ ...teamMatch, _id: staffOid }),
    EvacCheck.findOne(key).select("status markedAt markedByUserId").lean(),
  ]);
  if (!member) throw new AppError("not_direct_report", 403);

  const check =
    existing?.status === EvacCheckStatus.SAFE
      ? existing
      : await EvacCheck.findOneAndUpdate(
          key,
          {
            $set: {
              status: EvacCheckStatus.SAFE,
              markedAt: new Date(),
              markedByUserId: actor._id,
            },
            $setOnInsert: key,
          },
          { new: true, upsert: true, runValidators: true },
        )
          .select("status markedAt markedByUserId")
          .lean();

  const markedBy =
    String(check.markedByUserId) === String(actor._id)
      ? { _id: actor._id, name: actor.name || "" }
      : check.markedByUserId
        ? await User.findById(check.markedByUserId).select("name").lean()
        : null;

  return {
    staffId: staffOid,
    onSite: true,
    status: check.status,
    markedAt: check.markedAt,
    markedBy: markedBy ? { _id: markedBy._id, name: markedBy.name || "" } : null,
  };
};

module.exports = { listTeamRollcall, markTeamMemberSafe };
