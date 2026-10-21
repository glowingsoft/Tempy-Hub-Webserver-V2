const { Resident } = require("@models/Resident");
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

  // the link goes to the invitee by email; the sender never holds the token
  return {
    invitationId: invitation._id,
    email: invitation.email,
    name: invitation.name,
    relationship: invitation.relationship,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };
};

module.exports = { inviteRelative };
