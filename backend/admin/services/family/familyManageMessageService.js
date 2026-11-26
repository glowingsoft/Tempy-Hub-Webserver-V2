const { Resident } = require("@models/Resident");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
  personFields,
} = require("@appServices/family/familyPipeline");
const familyMessageStaffService = require("./familyMessageStaffService");
const Message = require("../../../commonModules/chatModule/models/Message");

const findResident = async ({ organizationId, branchScope, residentId }) => {
  if (!residentId) throw new AppError("resident_id_required", 400);
  if (typeof residentId !== "string" || !isValidObjectId(residentId))
    throw new AppError("invalid_resident_id", 400);

  const [resident] = await Resident.aggregate([
    {
      $match: {
        _id: toObjectId(residentId),
        organizationId: toObjectId(organizationId),
        ...(branchScope ? { branchId: toObjectId(branchScope) } : {}),
      },
    },
    { $project: { name: 1, roomNumber: 1, photoUrl: 1, branchId: 1 } },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);
  return resident;
};

const familyName = (resident) => `${resident.name} Family`;

const getScreen = async (scope) => {
  const resident = await findResident(scope);
  const members = await FamilyMember.aggregate([
    {
      $match: {
        residentId: resident._id,
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    ...joinOne({ from: User, localField: "userId", as: "user" }),
    { $sort: { isNextOfKin: -1, createdAt: 1 } },
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        ...personFields(),
        relationship: 1,
        isNextOfKin: 1,
      },
    },
  ]);

  return {
    resident: {
      residentId: resident._id,
      name: resident.name,
      roomNumber: resident.roomNumber || "",
      photoUrl: resident.photoUrl || "",
    },
    familyName: familyName(resident),
    memberCount: members.length,
    nextOfKinName: members.find((member) => member.isNextOfKin)?.name || "",
    members,
    delivery: { inApp: true, inAppLocked: true, emailOptional: true },
    limits: {
      maxSubjectLength: Message.MAX_SUBJECT_LENGTH,
      maxMessageLength: Message.MAX_MESSAGE_LENGTH,
    },
    canSend: members.length > 0,
  };
};

const send = async ({
  actor,
  organizationId,
  branchScope,
  residentId,
  subject,
  message,
  alsoEmail,
}) => {
  const resident = await findResident({
    organizationId,
    branchScope,
    residentId,
  });
  const sent = await familyMessageStaffService.sendMessage({
    actor,
    organizationId,
    branchId: String(resident.branchId),
    audience: "family",
    residentIds: [String(resident._id)],
    subject,
    message,
    alsoEmail: alsoEmail === true || alsoEmail === "true",
  });

  return {
    broadcastId: sent.broadcastId,
    sentAt: sent.sentAt,
    subject: sent.subject,
    familyName: familyName(resident),
    recipients: sent.recipients,
    emailed: sent.emailed,
  };
};

module.exports = { getScreen, send };
