const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyHandover } = require("@models/FamilyHandover");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { FamilyHandoverStatus, FamilyMemberStatus } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/residents/residentAccess");
const { requireManageableResident } = require("./familyService");
const familyCodeService = require("@appServices/family/familyCodeService");
const {
  decidePendingRequest,
  removeActiveLink,
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
const joinResident = joinOne({ from: Resident, localField: "residentId", as: "resident" });

// ---------------------------------------------------------------- who and what

/** What a list covers: one resident, or everything the caller's role allows (a site manager sees their own site). */
const listScope = async ({ actor, organizationId, branchId, residentId }) => {
  const match = { organizationId: toObjectId(organizationId) };

  if (residentId) {
    const resident = await requireManageableResident({ actor, organizationId, residentId });
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

const loadLink = async ({ organizationId, linkId, residentId, notFoundKey }) => {
  if (!isValidObjectId(linkId)) throw new AppError(notFoundKey, 404);

  const match = { _id: toObjectId(linkId), organizationId: toObjectId(organizationId) };
  if (residentId) match.residentId = toObjectId(residentId);

  const [link] = await FamilyMember.aggregate([
    { $match: match },
    { $project: { residentId: 1, userId: 1, status: 1, isNextOfKin: 1 } },
  ]);
  if (!link) throw new AppError(notFoundKey, 404);
  return link;
};

// ---------------------------------------------------------------- members and next of kin

const listMembers = async ({ actor, organizationId, residentId }) => {
  const resident = await requireManageableResident({ actor, organizationId, residentId });

  const members = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(resident._id),
        status: { $in: [FamilyMemberStatus.ACTIVE, FamilyMemberStatus.PENDING] },
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

/** Also how the home finishes a "let the home choose" handover. */
const setNextOfKin = async ({ actor, organizationId, residentId, memberId }) => {
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
const removeMember = async ({ actor, organizationId, residentId, memberId }) => {
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

// ---------------------------------------------------------------- join requests

const listJoinRequests = async ({ actor, organizationId, branchId, residentId, page, limit, skip }) => {
  const match = await listScope({ actor, organizationId, branchId, residentId });

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

const decideJoinRequest = async ({ actor, organizationId, requestId, decision }) => {
  const link = await loadLink({
    organizationId,
    linkId: requestId,
    notFoundKey: "join_request_not_found",
  });
  await requireManageableResident({ actor, organizationId, residentId: link.residentId });

  if (link.status !== FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_not_pending", 409);
  }

  await decidePendingRequest({ linkId: link._id, decision, actorId: actor._id });
  return { requestId: link._id, status: decision };
};

// ---------------------------------------------------------------- handovers

/** Open handovers, so the home can see which families asked it to choose a new next of kin. */
const listHandovers = async ({ actor, organizationId, branchId, residentId, homeChooses, page, limit, skip }) => {
  const scope = await listScope({ actor, organizationId, branchId, residentId });
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
      ...joinOne({ from: User, localField: "toUserId", as: "to", optional: true }),
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

// ---------------------------------------------------------------- family code

const codeLinkFor = (resident) => ({
  residentId: resident._id,
  branchId: resident.branchId,
  organizationId: resident.organizationId,
});

const getCode = async ({ actor, organizationId, residentId }) => {
  const resident = await requireManageableResident({ actor, organizationId, residentId });
  return familyCodeService.getCurrentCode({ link: codeLinkFor(resident) });
};

const createCode = async ({ actor, organizationId, residentId }) => {
  const resident = await requireManageableResident({ actor, organizationId, residentId });
  return familyCodeService.createCode({ link: codeLinkFor(resident), userId: actor._id });
};

module.exports = {
  listMembers,
  setNextOfKin,
  removeMember,
  listJoinRequests,
  decideJoinRequest,
  listHandovers,
  getCode,
  createCode,
};
