const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyHandover } = require("@models/FamilyHandover");
const { FamilyUpload } = require("@models/FamilyUpload");
const { Branch } = require("@models/Branch");
const { paginateWithFacet, facetCount, allCountFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  FamilyHandoverStatus,
  FamilyMemberStatus,
  FamilyRelationship,
  FamilyUploadStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/residents/residentAccess");
const { requireManageableResident } = require("./familyService");
const { searchClause } = require("./familySearch");
const familyCodeService = require("@appServices/family/familyCodeService");
const {
  decidePendingRequest,
  removeActiveLink,
  deactivateActiveLink,
  reactivateLink,
  assignNextOfKin,
} = require("@appServices/family/familyLinkActions");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
  personFields,
  pickPerson,
} = require("@appServices/family/familyPipeline");

const joinUser = joinOne({ from: User, localField: "userId", as: "user" });
const joinResident = joinOne({
  from: Resident,
  localField: "residentId",
  as: "resident",
});

/** What a list covers: one resident, or everything the caller's role allows (a site manager sees their own site). */
const listScope = async ({ actor, organizationId, branchId, residentId }) => {
  const match = { organizationId: toObjectId(organizationId) };

  if (residentId) {
    const resident = await requireManageableResident({
      actor,
      organizationId,
      residentId,
    });
    return { ...match, residentId: toObjectId(resident._id) };
  }

  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayAccessResidents(standing, scopedBranchId);

  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    match.branchId = toObjectId(scopedBranchId);
  }
  return match;
};

const loadLink = async ({
  organizationId,
  linkId,
  residentId,
  notFoundKey,
}) => {
  if (!isValidObjectId(linkId)) throw new AppError(notFoundKey, 404);

  const match = {
    _id: toObjectId(linkId),
    organizationId: toObjectId(organizationId),
  };
  if (residentId) match.residentId = toObjectId(residentId);

  const [link] = await FamilyMember.aggregate([
    { $match: match },
    { $project: { residentId: 1, userId: 1, status: 1, isNextOfKin: 1 } },
  ]);
  if (!link) throw new AppError(notFoundKey, 404);
  return link;
};

// reading is open across the organization; changing stays within the caller's site
const requireReadableResident = async ({ organizationId, residentId }) => {
  if (!isValidObjectId(residentId))
    throw new AppError("resident_not_found", 404);
  const [resident] = await Resident.aggregate([
    {
      $match: {
        _id: toObjectId(residentId),
        organizationId: toObjectId(organizationId),
      },
    },
    { $project: { name: 1, branchId: 1 } },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);
  return resident;
};

const memberRow = {
  _id: 0,
  memberId: "$_id",
  residentId: 1,
  ...personFields(),
  email: { $ifNull: ["$user.email", ""] },
  relationship: 1,
  isNextOfKin: 1,
  status: 1,
  joinedVia: 1,
  requestedAt: 1,
};

/** Someone who was removed from a family is gone from these lists, the counts and the pages. */
const LISTED_STATUSES = Object.values(FamilyMemberStatus).filter(
  (status) => status !== FamilyMemberStatus.REMOVED,
);

const statusCountsOf = (rows = [], result) => {
  const counts = {
    all: facetCount(result?.allCount),
    ...Object.fromEntries(LISTED_STATUSES.map((status) => [status, 0])),
  };
  rows.forEach((row) => {
    if (row._id in counts) counts[row._id] = row.count;
  });
  return counts;
};

/** Without a status it lists active, pending and inactive; meta.counts covers the other statuses too (never removed) and ignores the status filter. */
const listAllMembers = async ({
  organizationId,
  branchId,
  residentId,
  status,
  isNextOfKin,
  keyword,
  page,
  limit,
  skip,
}) => {
  if (status && !LISTED_STATUSES.includes(status)) {
    throw new AppError("invalid_status_filter", 400);
  }

  const base = {
    organizationId: toObjectId(organizationId),
    status: { $ne: FamilyMemberStatus.REMOVED },
  };
  if (branchId) base.branchId = toObjectId(branchId);
  if (residentId) base.residentId = toObjectId(residentId);
  if (isNextOfKin === "true" || isNextOfKin === "false")
    base.isNextOfKin = isNextOfKin === "true";

  const or = await searchClause({
    keyword,
    organizationId,
    branchId,
    resident: "residentId",
    person: { model: FamilyMember, field: "userId", path: "userId" },
  });
  if (or) base.$or = or;

  const match = {
    ...base,
    status: status || {
      $in: [
        FamilyMemberStatus.ACTIVE,
        FamilyMemberStatus.PENDING,
        FamilyMemberStatus.INACTIVE,
      ],
    },
  };

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyMember,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: 1 },
    extraFacets: {
      ...allCountFacet(base),
      statusCounts: [
        { $match: base },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ],
    },
    extraDataStages: [
      ...joinUser,
      ...joinResident,
      ...joinOne({
        from: Branch,
        localField: "branchId",
        as: "branch",
        optional: true,
      }),
      {
        $project: {
          ...memberRow,
          residentName: { $ifNull: ["$resident.name", ""] },
          roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
          residentPhotoUrl: { $ifNull: ["$resident.photoUrl", ""] },
          branchId: 1,
          homeName: { $ifNull: ["$branch.name", ""] },
          joinedAt: "$createdAt",
        },
      },
    ],
  });

  return {
    data,
    meta: { ...meta, counts: statusCountsOf(result.statusCounts, result) },
  };
};

const uploadCountsOf = (rows = []) => {
  const counts = Object.fromEntries(
    Object.values(FamilyUploadStatus).map((status) => [status, 0]),
  );
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

const getMember = async ({ organizationId, branchId, memberId }) => {
  if (!isValidObjectId(memberId))
    throw new AppError("family_member_not_found", 404);

  const [member] = await FamilyMember.aggregate([
    {
      $match: {
        _id: toObjectId(memberId),
        organizationId: toObjectId(organizationId),
        ...(branchId ? { branchId: toObjectId(branchId) } : {}),
      },
    },
    ...joinUser,
    ...joinResident,
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    ...joinOne({
      from: User,
      localField: "decidedBy",
      as: "decider",
      optional: true,
    }),
    ...joinOne({
      from: User,
      localField: "removedBy",
      as: "remover",
      optional: true,
    }),
    ...joinOne({
      from: User,
      localField: "inactiveBy",
      as: "pauser",
      optional: true,
    }),
    {
      $lookup: {
        from: FamilyUpload.collection.name,
        let: { authorId: "$userId", residentId: "$residentId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$authorId", "$$authorId"] },
                  { $eq: ["$residentId", "$$residentId"] },
                ],
              },
            },
          },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ],
        as: "uploadStats",
      },
    },
    {
      $lookup: {
        from: FamilyMember.collection.name,
        let: { residentId: "$residentId" },
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
          { $count: "count" },
        ],
        as: "familySize",
      },
    },
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        userId: 1,
        ...personFields(),
        email: { $ifNull: ["$user.email", ""] },
        phone: { $ifNull: ["$user.phoneNumber", ""] },
        relationship: 1,
        isNextOfKin: 1,
        status: 1,
        joinedVia: 1,
        residentId: 1,
        residentName: { $ifNull: ["$resident.name", ""] },
        roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
        residentPhotoUrl: { $ifNull: ["$resident.photoUrl", ""] },
        branchId: 1,
        homeName: { $ifNull: ["$branch.name", ""] },
        familySize: {
          $ifNull: [{ $arrayElemAt: ["$familySize.count", 0] }, 0],
        },
        uploadStats: 1,
        joinedAt: "$createdAt",
        requestedAt: 1,
        decidedAt: 1,
        decidedByName: { $ifNull: ["$decider.name", ""] },
        removedAt: 1,
        removedByName: { $ifNull: ["$remover.name", ""] },
        inactiveAt: 1,
        inactiveByName: { $ifNull: ["$pauser.name", ""] },
      },
    },
  ]);
  if (!member) throw new AppError("family_member_not_found", 404);

  const { uploadStats, ...detail } = member;
  return { ...detail, uploads: uploadCountsOf(uploadStats) };
};

const listMembers = async ({ organizationId, residentId }) => {
  const resident = await requireReadableResident({
    organizationId,
    residentId,
  });

  const members = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(resident._id),
        status: {
          $in: [FamilyMemberStatus.ACTIVE, FamilyMemberStatus.PENDING],
        },
      },
    },
    ...joinUser,
    { $sort: { isNextOfKin: -1, status: 1, createdAt: 1 } },
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        ...personFields(),
        email: { $ifNull: ["$user.email", ""] },
        relationship: 1,
        isNextOfKin: 1,
        status: 1,
        joinedVia: 1,
        requestedAt: 1,
      },
    },
  ]);

  return { residentId: resident._id, residentName: resident.name, members };
};

const EDITABLE_STATUSES = [
  FamilyMemberStatus.ACTIVE,
  FamilyMemberStatus.PENDING,
  FamilyMemberStatus.INACTIVE,
];

/** Staff fix how someone is listed: their relationship. Their name, email and phone belong to their account. */
const editMember = async ({
  actor,
  organizationId,
  memberId,
  relationship,
}) => {
  const link = await loadLink({
    organizationId,
    linkId: memberId,
    notFoundKey: "family_member_not_found",
  });
  await requireManageableResident({
    actor,
    organizationId,
    residentId: link.residentId,
  });
  if (!EDITABLE_STATUSES.includes(link.status))
    throw new AppError("family_member_not_editable", 409);

  const set = {};
  if (relationship !== undefined) {
    if (!Object.values(FamilyRelationship).includes(relationship))
      throw new AppError("invalid_relationship", 400);
    set.relationship = relationship;
  }
  if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);

  const updated = await FamilyMember.updateOne(
    { _id: link._id, status: { $in: EDITABLE_STATUSES } },
    { $set: set },
  );
  if (!updated.modifiedCount && !updated.matchedCount)
    throw new AppError("family_member_not_editable", 409);

  return getMember({ organizationId, memberId });
};

/** Pause someone's access, or switch it back on. The next of kin cannot be paused: hand over first. */
const changeMemberAccess = async ({
  actor,
  organizationId,
  memberId,
  action,
}) => {
  const link = await loadLink({
    organizationId,
    linkId: memberId,
    notFoundKey: "family_member_not_found",
  });
  await requireManageableResident({
    actor,
    organizationId,
    residentId: link.residentId,
  });

  if (action === "deactivate") {
    if (link.isNextOfKin)
      throw new AppError("next_of_kin_cannot_be_deactivated", 409);
    if (link.status !== FamilyMemberStatus.ACTIVE)
      throw new AppError("family_member_not_active", 409);
    await deactivateActiveLink({ link, actorId: actor._id });
    return { memberId: link._id, status: FamilyMemberStatus.INACTIVE };
  }

  await reactivateLink({ link });
  return { memberId: link._id, status: FamilyMemberStatus.ACTIVE };
};

/** Also how the home finishes a "let the home choose" handover. */
const setNextOfKin = async ({
  actor,
  organizationId,
  residentId,
  memberId,
}) => {
  await requireManageableResident({ actor, organizationId, residentId });
  const link = await loadLink({
    organizationId,
    linkId: memberId,
    residentId,
    notFoundKey: "family_member_not_found",
  });

  if (link.status === FamilyMemberStatus.PENDING) {
    throw new AppError("handover_member_not_approved", 409);
  }
  if (link.status !== FamilyMemberStatus.ACTIVE) {
    throw new AppError("family_member_not_found", 404);
  }
  if (link.isNextOfKin) throw new AppError("next_of_kin_already", 409);

  await assignNextOfKin({ target: link });
  return { residentId: link.residentId, memberId: link._id, isNextOfKin: true };
};

/** Unlike the family app, staff may remove the next of kin too, which leaves the resident without one. */
const removeMember = async ({
  actor,
  organizationId,
  residentId,
  memberId,
}) => {
  await requireManageableResident({ actor, organizationId, residentId });
  const link = await loadLink({
    organizationId,
    linkId: memberId,
    residentId,
    notFoundKey: "family_member_not_found",
  });

  if (link.status === FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_use_reject", 409);
  }
  if (link.status !== FamilyMemberStatus.ACTIVE) {
    throw new AppError("family_member_not_found", 404);
  }

  await removeActiveLink({ link, actorId: actor._id });
  return { memberId: link._id, status: FamilyMemberStatus.REMOVED };
};

const listJoinRequests = async ({
  actor,
  organizationId,
  branchId,
  residentId,
  page,
  limit,
  skip,
}) => {
  const match = await listScope({
    actor,
    organizationId,
    branchId,
    residentId,
  });

  return paginateWithFacet({
    model: FamilyMember,
    match: { ...match, status: FamilyMemberStatus.PENDING },
    page,
    limit,
    skip,
    sort: { requestedAt: 1 },
    extraDataStages: [
      ...joinUser,
      ...joinResident,
      {
        $project: {
          _id: 0,
          requestId: "$_id",
          residentId: 1,
          residentName: { $ifNull: ["$resident.name", ""] },
          ...personFields(),
          email: { $ifNull: ["$user.email", ""] },
          relationship: 1,
          requestedAt: 1,
        },
      },
    ],
  });
};

const decideJoinRequest = async ({
  actor,
  organizationId,
  requestId,
  decision,
}) => {
  const link = await loadLink({
    organizationId,
    linkId: requestId,
    notFoundKey: "join_request_not_found",
  });
  await requireManageableResident({
    actor,
    organizationId,
    residentId: link.residentId,
  });

  if (link.status !== FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_not_pending", 409);
  }

  await decidePendingRequest({
    linkId: link._id,
    decision,
    actorId: actor._id,
  });
  return { requestId: link._id, status: decision };
};

const listHandovers = async ({
  actor,
  organizationId,
  branchId,
  residentId,
  homeChooses,
  page,
  limit,
  skip,
}) => {
  const scope = await listScope({
    actor,
    organizationId,
    branchId,
    residentId,
  });
  const match = { ...scope, status: FamilyHandoverStatus.PENDING };
  if (String(homeChooses) === "true") match.homeChooses = true;

  const { data, meta } = await paginateWithFacet({
    model: FamilyHandover,
    match,
    page,
    limit,
    skip,
    sort: { requestedAt: 1 },
    extraDataStages: [
      ...joinResident,
      ...joinOne({ from: User, localField: "fromUserId", as: "from" }),
      ...joinOne({
        from: User,
        localField: "toUserId",
        as: "to",
        optional: true,
      }),
      {
        $project: {
          _id: 0,
          handoverId: "$_id",
          residentId: 1,
          residentName: { $ifNull: ["$resident.name", ""] },
          homeChooses: 1,
          requestedAt: 1,
          ...personFields("from", "from"),
          ...personFields("to", "to"),
        },
      },
    ],
  });

  return {
    data: data.map((row) => ({
      handoverId: row.handoverId,
      residentId: row.residentId,
      residentName: row.residentName,
      homeChooses: row.homeChooses,
      requestedAt: row.requestedAt,
      from: pickPerson(row, "from"),
      to: row.homeChooses ? null : pickPerson(row, "to"),
    })),
    meta,
  };
};

const codeLinkFor = (resident) => ({
  residentId: resident._id,
  branchId: resident.branchId,
  organizationId: resident.organizationId,
});

const getCode = async ({ actor, organizationId, residentId }) => {
  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId,
  });
  return familyCodeService.getCurrentCode({ link: codeLinkFor(resident) });
};

const createCode = async ({ actor, organizationId, residentId }) => {
  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId,
  });
  return familyCodeService.createCode({
    link: codeLinkFor(resident),
    userId: actor._id,
  });
};

module.exports = {
  listScope,
  listMembers,
  listAllMembers,
  getMember,
  editMember,
  changeMemberAccess,
  setNextOfKin,
  removeMember,
  listJoinRequests,
  decideJoinRequest,
  listHandovers,
  getCode,
  createCode,
};
