const { Resident } = require("@models/Resident");
const { FamilyInvitation } = require("@models/FamilyInvitation");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { FamilyRelationship } = require("@models/domainEnums");
const { createInvitation } = require("@adminServices/family/familyService");
const { toObjectId } = require("./familyPipeline");

const findResident = async (link) => {
  const [resident] = await Resident.aggregate([
    {
      $match: {
        _id: toObjectId(link.residentId),
        organizationId: toObjectId(link.organizationId),
      },
    },
    { $project: { name: 1, branchId: 1 } },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);
  return resident;
};

/** Invite Family: the next of kin invites a relative by name, email and relationship. */
const inviteRelative = async ({ userId, link, name, email, relationship }) => {
  if (!String(name || "").trim()) throw new AppError("name_required", 400);
  if (!Object.values(FamilyRelationship).includes(relationship)) {
    throw new AppError("invalid_relationship", 400);
  }

  const resident = await findResident(link);
  const invitation = await createInvitation({
    inviterId: userId,
    organizationId: link.organizationId,
    resident,
    email,
    name: String(name).trim(),
    relationship,
  });

  const sent = {
    invitationId: invitation._id,
    email: invitation.email,
    name: invitation.name,
    relationship: invitation.relationship,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };

  // The link reaches the invitee by email and the sender must not hold it. While email is off
  // (development and testing) nothing is delivered, so the link is returned instead.
  return process.env.EMAIL_ENABLED === "true" ? sent : { ...sent, acceptUrl: invitation.acceptUrl };
};

const listSentInvitations = ({ userId, link, status, page, limit, skip }) =>
  paginateWithFacet({
    model: FamilyInvitation,
    match: {
      residentId: toObjectId(link.residentId),
      invitedByUserId: toObjectId(userId),
      ...(status ? { status } : {}),
    },
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: [
      {
        $project: {
          _id: 0,
          invitationId: "$_id",
          name: 1,
          email: 1,
          relationship: 1,
          status: 1,
          expiresAt: 1,
          lastSentAt: 1,
          createdAt: 1,
        },
      },
    ],
  });

module.exports = { inviteRelative, listSentInvitations };
