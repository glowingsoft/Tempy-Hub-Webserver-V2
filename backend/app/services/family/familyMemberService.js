const { User } = require("@models/UserModel");
const { Organization } = require("@models/Organization");
const { FamilyMember } = require("@models/FamilyMember");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { isFamilyModuleActive } = require("./familyAccessService");
const { decidePendingRequest, removeActiveLink } = require("./familyLinkActions");
const { toObjectId, isValidObjectId, joinOne, personFields } = require("./familyPipeline");

const joinUser = joinOne({ from: User, localField: "userId", as: "user" });

// ---------------------------------------------------------------- who may act

const callerIsNextOfKin = (callerId) => ({
  $gt: [
    {
      $size: {
        $filter: {
          input: "$family",
          as: "member",
          cond: {
            $and: [
              { $eq: ["$$member.userId", callerId] },
              { $eq: ["$$member.status", FamilyMemberStatus.ACTIVE] },
              { $eq: ["$$member.isNextOfKin", true] },
            ],
          },
        },
      },
    },
    0,
  ],
});

/** Anything the caller may not act on is a 404, so other families' members and requests stay hidden. */
const loadForNextOfKin = async ({ userId, linkId, notFoundKey }) => {
  if (!isValidObjectId(linkId)) throw new AppError(notFoundKey, 404);

  const [row] = await FamilyMember.aggregate([
    { $match: { _id: toObjectId(linkId) } },
    {
      $lookup: {
        from: FamilyMember.collection.name,
        localField: "residentId",
        foreignField: "residentId",
        as: "family",
      },
    },
    ...joinOne({ from: Organization, localField: "organizationId", as: "organization" }),
    {
      $project: {
        residentId: 1,
        userId: 1,
        status: 1,
        isNextOfKin: 1,
        "organization.moduleAccess": 1,
        callerIsNextOfKin: callerIsNextOfKin(toObjectId(userId)),
      },
    },
  ]);

  const allowed = row && row.callerIsNextOfKin && isFamilyModuleActive(row.organization);
  if (!allowed) throw new AppError(notFoundKey, 404);
  return row;
};

// ---------------------------------------------------------------- listing

// next of kin first, then active members in the order they joined, then requests
const memberOrderStages = [
  {
    $addFields: {
      rank: {
        $switch: {
          branches: [
            { case: { $eq: ["$isNextOfKin", true] }, then: 0 },
            { case: { $eq: ["$status", FamilyMemberStatus.ACTIVE] }, then: 1 },
          ],
          default: 2,
        },
      },
    },
  },
  { $sort: { rank: 1, createdAt: 1 } },
];

const withActions = (member, canManage) => ({
  ...member,
  canRemove:
    canManage && member.status === FamilyMemberStatus.ACTIVE && !member.isNextOfKin,
  canReview: canManage && member.status === FamilyMemberStatus.PENDING,
});

/** The next of kin also sees (and can act on) people who asked to join; everyone else sees active members only. */
const listMembers = async ({ userId, link }) => {
  const canManage = Boolean(link.isNextOfKin);
  const visibleStatuses = canManage
    ? [FamilyMemberStatus.ACTIVE, FamilyMemberStatus.PENDING]
    : [FamilyMemberStatus.ACTIVE];

  const members = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(link.residentId),
        status: { $in: visibleStatuses },
      },
    },
    ...joinUser,
    ...memberOrderStages,
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        ...personFields(),
        relationship: 1,
        isNextOfKin: 1,
        status: 1,
        requestedAt: 1,
        isYou: { $eq: ["$userId", toObjectId(userId)] },
      },
    },
  ]);

  return {
    residentId: link.residentId,
    canManage,
    members: members.map((member) => withActions(member, canManage)),
  };
};

const listJoinRequests = ({ link, page, limit, skip }) =>
  paginateWithFacet({
    model: FamilyMember,
    match: {
      residentId: toObjectId(link.residentId),
      status: FamilyMemberStatus.PENDING,
    },
    page,
    limit,
    skip,
    sort: { requestedAt: 1 },
    extraDataStages: [
      ...joinUser,
      {
        $project: {
          _id: 0,
          requestId: "$_id",
          ...personFields(),
          email: { $ifNull: ["$user.email", ""] },
          relationship: 1,
          joinedVia: 1,
          requestedAt: 1,
        },
      },
    ],
  });

// ---------------------------------------------------------------- deciding and removing

const decideJoinRequest = async ({ userId, requestId, decision }) => {
  const row = await loadForNextOfKin({
    userId,
    linkId: requestId,
    notFoundKey: "join_request_not_found",
  });
  if (row.status !== FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_not_pending", 409);
  }

  await decidePendingRequest({ linkId: row._id, decision, actorId: userId });
  return { requestId: row._id, status: decision };
};

/** The next of kin can't be removed (they hand over first); an unapproved request is rejected, not removed. */
const removeMember = async ({ userId, memberId }) => {
  const row = await loadForNextOfKin({
    userId,
    linkId: memberId,
    notFoundKey: "family_member_not_found",
  });

  if (row.isNextOfKin) throw new AppError("next_of_kin_cannot_be_removed", 409);
  if (row.status === FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_use_reject", 409);
  }
  if (row.status !== FamilyMemberStatus.ACTIVE) {
    throw new AppError("family_member_not_found", 404);
  }

  await removeActiveLink({ link: row, actorId: userId });

  return { memberId: row._id, status: FamilyMemberStatus.REMOVED };
};

module.exports = {
  listMembers,
  listJoinRequests,
  decideJoinRequest,
  removeMember,
};
