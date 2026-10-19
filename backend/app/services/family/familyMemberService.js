const mongoose = require("mongoose");
const { User } = require("@models/UserModel");
const { Organization } = require("@models/Organization");
const { FamilyMember } = require("@models/FamilyMember");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { isFamilyModuleActive } = require("./familyAccessService");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const userStages = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "userId",
      foreignField: "_id",
      as: "user",
    },
  },
  { $unwind: "$user" },
];

/** Anything the caller may not act on is a 404, so other families' members and requests stay hidden. */
const loadForNextOfKin = async ({ userId, linkId, notFoundKey }) => {
  if (!mongoose.Types.ObjectId.isValid(linkId)) throw new AppError(notFoundKey, 404);

  const callerId = toObjectId(userId);
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
    {
      $lookup: {
        from: Organization.collection.name,
        localField: "organizationId",
        foreignField: "_id",
        as: "organization",
      },
    },
    { $unwind: "$organization" },
    {
      $project: {
        residentId: 1,
        userId: 1,
        status: 1,
        isNextOfKin: 1,
        "organization.moduleAccess": 1,
        callerIsNextOfKin: {
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
        },
      },
    },
  ]);

  if (!row || !row.callerIsNextOfKin || !isFamilyModuleActive(row.organization)) {
    throw new AppError(notFoundKey, 404);
  }
  return row;
};

/** The next of kin also sees (and can act on) people who asked to join; everyone else sees active members only. */
const listMembers = async ({ userId, link }) => {
  const canManage = Boolean(link.isNextOfKin);

  const rows = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(link.residentId),
        status: {
          $in: canManage
            ? [FamilyMemberStatus.ACTIVE, FamilyMemberStatus.PENDING]
            : [FamilyMemberStatus.ACTIVE],
        },
      },
    },
    ...userStages,
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
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        name: { $ifNull: ["$user.name", ""] },
        photoUrl: { $ifNull: ["$user.profileIcon", ""] },
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
    members: rows.map((row) => ({
      ...row,
      canRemove:
        canManage && row.status === FamilyMemberStatus.ACTIVE && !row.isNextOfKin,
      canReview: canManage && row.status === FamilyMemberStatus.PENDING,
    })),
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
      ...userStages,
      {
        $project: {
          _id: 0,
          requestId: "$_id",
          name: { $ifNull: ["$user.name", ""] },
          photoUrl: { $ifNull: ["$user.profileIcon", ""] },
          relationship: 1,
          requestedAt: 1,
        },
      },
    ],
  });

const decideJoinRequest = async ({ userId, requestId, decision }) => {
  const row = await loadForNextOfKin({
    userId,
    linkId: requestId,
    notFoundKey: "join_request_not_found",
  });

  if (row.status !== FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_not_pending", 409);
  }

  // The status is part of the filter, so two people deciding at once cannot both win.
  const result = await FamilyMember.updateOne(
    { _id: row._id, status: FamilyMemberStatus.PENDING },
    {
      $set: {
        status: decision,
        decidedBy: userId,
        decidedAt: new Date(),
      },
    }
  );
  if (!result.modifiedCount) throw new AppError("join_request_not_pending", 409);

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

  const result = await FamilyMember.updateOne(
    { _id: row._id, status: FamilyMemberStatus.ACTIVE },
    {
      $set: {
        status: FamilyMemberStatus.REMOVED,
        removedBy: userId,
        removedAt: new Date(),
      },
    }
  );
  if (!result.modifiedCount) throw new AppError("family_member_not_found", 404);

  return { memberId: row._id, status: FamilyMemberStatus.REMOVED };
};

module.exports = {
  listMembers,
  listJoinRequests,
  decideJoinRequest,
  removeMember,
};
