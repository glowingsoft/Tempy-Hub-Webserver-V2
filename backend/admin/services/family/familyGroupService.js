const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyInvitation } = require("@models/FamilyInvitation");
const { keywordOr, facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const {
  AdmissionStatus,
  FamilyMemberStatus,
  FamilyInvitationStatus,
} = require("@models/domainEnums");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
} = require("@appServices/family/familyPipeline");
const { searchText } = require("@utils/familyQuery");

const FamilyGroupStatus = {
  ACTIVE: "active",
  INVITE_PENDING: "invitePending",
  NO_FAMILY: "noFamily",
};

const first = (array) => ({ $arrayElemAt: [array, 0] });

const nextOfKinOnly = (array) => ({
  $filter: {
    input: array,
    as: "item",
    cond: { $eq: ["$$item.isNextOfKin", true] },
  },
});

const groupStages = (now) => [
  {
    $lookup: {
      from: FamilyMember.collection.name,
      let: { residentId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$residentId", "$$residentId"] },
                { $eq: ["$status", FamilyMemberStatus.ACTIVE] },
              ],
            },
          },
        },
        { $project: { userId: 1, isNextOfKin: 1, relationship: 1 } },
      ],
      as: "activeLinks",
    },
  },
  {
    $lookup: {
      from: FamilyInvitation.collection.name,
      let: { residentId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$residentId", "$$residentId"] },
                { $eq: ["$status", FamilyInvitationStatus.PENDING] },
                { $gt: ["$expiresAt", now] },
              ],
            },
          },
        },
        { $sort: { createdAt: -1 } },
        { $project: { name: 1, relationship: 1, isNextOfKin: 1 } },
      ],
      as: "pendingInvites",
    },
  },
  {
    $addFields: {
      nokLink: first(nextOfKinOnly("$activeLinks")),
      nokInvite: first(nextOfKinOnly("$pendingInvites")),
      membersCount: { $size: "$activeLinks" },
      pendingInvitationsCount: { $size: "$pendingInvites" },
      status: {
        $switch: {
          branches: [
            {
              case: { $gt: [{ $size: "$activeLinks" }, 0] },
              then: FamilyGroupStatus.ACTIVE,
            },
            {
              case: { $gt: [{ $size: "$pendingInvites" }, 0] },
              then: FamilyGroupStatus.INVITE_PENDING,
            },
          ],
          default: FamilyGroupStatus.NO_FAMILY,
        },
      },
    },
  },
  ...joinOne({
    from: User,
    localField: "nokLink.userId",
    as: "nokUser",
    optional: true,
  }),
  {
    $addFields: {
      nextOfKinName: {
        $ifNull: ["$nokUser.name", { $ifNull: ["$nokInvite.name", ""] }],
      },
      nextOfKinPhotoUrl: { $ifNull: ["$nokUser.profileIcon", ""] },
      nextOfKinRelationship: {
        $ifNull: [
          "$nokLink.relationship",
          { $ifNull: ["$nokInvite.relationship", ""] },
        ],
      },
      // the invitation Resend acts on: the next of kin's, else the newest pending one
      pendingInvitationId: {
        $ifNull: [
          "$nokInvite._id",
          { $ifNull: [first("$pendingInvites._id"), null] },
        ],
      },
    },
  },
];

const countsOf = (rows = []) => {
  const counts = Object.fromEntries(
    Object.values(FamilyGroupStatus).map((status) => [status, 0]),
  );
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return {
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    ...counts,
  };
};

/** One row per admitted resident. meta.counts ignores the status filter so the tabs stay stable. */
const listFamilyGroups = async ({
  organizationId,
  branchId,
  status,
  keyword,
  page,
  limit,
  skip,
}) => {
  if (status && !Object.values(FamilyGroupStatus).includes(status)) {
    throw new AppError("invalid_status_filter", 400);
  }

  const resident = {
    organizationId: toObjectId(organizationId),
    admissionStatus: AdmissionStatus.ADMITTED,
  };
  if (branchId) resident.branchId = toObjectId(branchId);

  const search = [];
  const or = keywordOr(
    searchText(keyword),
    ["name", "roomNumber", "nextOfKinName"],
    { trim: true },
  );
  if (or) search.push({ $match: { $or: or } });

  const wanted = status ? [{ $match: { status } }] : [];

  const [result] = await Resident.aggregate([
    { $match: resident },
    ...groupStages(new Date()),
    ...search,
    {
      $facet: {
        data: [
          ...wanted,
          { $sort: { name: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              residentId: "$_id",
              residentName: "$name",
              photoUrl: { $ifNull: ["$photoUrl", ""] },
              roomNumber: { $ifNull: ["$roomNumber", ""] },
              branchId: 1,
              nextOfKinName: 1,
              nextOfKinPhotoUrl: 1,
              nextOfKinRelationship: 1,
              membersCount: 1,
              pendingInvitationsCount: 1,
              pendingInvitationId: 1,
              status: 1,
            },
          },
        ],
        totalCount: [...wanted, { $count: "count" }],
        statusCounts: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
      },
    },
  ]);

  const counts = countsOf(result.statusCounts);
  const totalRecords = facetCount(result.totalCount);
  return {
    data: result.data,
    meta: { ...generateMeta(page, limit, totalRecords), counts },
  };
};

const GROUP_MEMBER_STATUSES = [
  FamilyMemberStatus.ACTIVE,
  FamilyMemberStatus.INACTIVE,
];

/**
 * One resident's family group, as the detail page shows it: the resident, the primary next of kin,
 * the linked members and a summary. The group id is the resident's id.
 */
const getFamilyGroup = async ({ organizationId, residentId }) => {
  if (!isValidObjectId(residentId))
    throw new AppError("resident_not_found", 404);

  const now = new Date();
  const [resident] = await Resident.aggregate([
    {
      $match: {
        _id: toObjectId(residentId),
        organizationId: toObjectId(organizationId),
        admissionStatus: AdmissionStatus.ADMITTED,
      },
    },
    ...groupStages(now),
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    {
      $project: {
        _id: 0,
        residentId: "$_id",
        residentName: "$name",
        photoUrl: { $ifNull: ["$photoUrl", ""] },
        roomNumber: { $ifNull: ["$roomNumber", ""] },
        branchId: 1,
        homeName: { $ifNull: ["$branch.name", ""] },
        status: 1,
        pendingInvitationsCount: 1,
      },
    },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);

  const [members, pendingInvitations] = await Promise.all([
    FamilyMember.aggregate([
      {
        $match: {
          organizationId: toObjectId(organizationId),
          residentId: toObjectId(residentId),
          status: { $in: GROUP_MEMBER_STATUSES },
        },
      },
      ...joinOne({
        from: User,
        localField: "userId",
        as: "user",
        optional: true,
      }),
      { $sort: { isNextOfKin: -1, createdAt: 1, _id: 1 } },
      {
        $project: {
          _id: 0,
          memberId: "$_id",
          userId: 1,
          name: { $ifNull: ["$user.name", ""] },
          photoUrl: { $ifNull: ["$user.profileIcon", ""] },
          email: { $ifNull: ["$user.email", ""] },
          phone: { $ifNull: ["$user.phoneNumber", ""] },
          relationship: 1,
          isNextOfKin: 1,
          status: 1,
          joinedAt: { $ifNull: ["$decidedAt", "$createdAt"] },
        },
      },
    ]),
    FamilyInvitation.aggregate([
      {
        $match: {
          organizationId: toObjectId(organizationId),
          residentId: toObjectId(residentId),
          status: FamilyInvitationStatus.PENDING,
          expiresAt: { $gt: now },
        },
      },
      { $sort: { isNextOfKin: -1, createdAt: -1 } },
      {
        $project: {
          _id: 0,
          invitationId: "$_id",
          name: 1,
          email: 1,
          relationship: 1,
          isNextOfKin: 1,
          expiresAt: 1,
          createdAt: 1,
        },
      },
    ]),
  ]);

  const rows = members;

  const kin = rows.find(
    (member) =>
      member.isNextOfKin && member.status === FamilyMemberStatus.ACTIVE,
  );
  const kinInvite = pendingInvitations.find(
    (invitation) => invitation.isNextOfKin,
  );
  const primaryNextOfKin = kin
    ? {
        memberId: kin.memberId,
        name: kin.name,
        photoUrl: kin.photoUrl,
        relationship: kin.relationship,
        email: kin.email,
        phone: kin.phone,
        status: kin.status,
      }
    : kinInvite
      ? {
          memberId: null,
          name: kinInvite.name,
          photoUrl: "",
          relationship: kinInvite.relationship,
          email: kinInvite.email,
          phone: "",
          status: "invited",
        }
      : null;

  return {
    ...resident,
    groupId: resident.residentId,
    primaryNextOfKin,
    members: rows,
    pendingInvitations: pendingInvitations.map(
      ({ isNextOfKin, ...invitation }) => ({ ...invitation, isNextOfKin }),
    ),
    summary: {
      totalLinkedMembers: rows.length,
      activePortalUsers: rows.filter(
        (member) => member.status === FamilyMemberStatus.ACTIVE,
      ).length,
      pendingInvites: pendingInvitations.length,
      groupId: resident.residentId,
    },
  };
};

module.exports = { listFamilyGroups, getFamilyGroup };
