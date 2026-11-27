const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const {
  AdmissionStatus,
  FamilyMemberStatus,
} = require("@models/domainEnums");
const { toObjectId, joinOne } = require("@appServices/family/familyPipeline");
const {
  moduleActiveStage,
} = require("@appServices/family/familyAccessService");

const findResidentAccount = async (userId) => {
  const [resident] = await Resident.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        admissionStatus: AdmissionStatus.ADMITTED,
      },
    },
    { $limit: 1 },
    ...joinOne({
      from: Organization,
      localField: "organizationId",
      as: "organization",
      optional: true,
    }),
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
        name: 1,
        photoUrl: { $ifNull: ["$photoUrl", ""] },
        roomNumber: { $ifNull: ["$roomNumber", ""] },
        organizationId: 1,
        organizationName: { $ifNull: ["$organization.name", ""] },
        branchId: 1,
        branchName: { $ifNull: ["$branch.name", ""] },
      },
    },
  ]);
  return resident || null;
};

const findNextOfKinName = async (residentId) => {
  const [contact] = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        status: FamilyMemberStatus.ACTIVE,
        isNextOfKin: true,
      },
    },
    ...joinOne({
      from: Organization,
      localField: "organizationId",
      as: "organization",
    }),
    moduleActiveStage(new Date()),
    { $sort: { createdAt: 1, _id: 1 } },
    { $limit: 1 },
    ...joinOne({ from: User, localField: "userId", as: "user" }),
    { $project: { _id: 0, name: "$user.name" } },
  ]);
  return contact?.name || null;
};

module.exports = { findResidentAccount, findNextOfKinName };
