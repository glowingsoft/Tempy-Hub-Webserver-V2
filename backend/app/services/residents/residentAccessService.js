const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { AdmissionStatus } = require("@models/domainEnums");
const { toObjectId, joinOne } = require("@appServices/family/familyPipeline");

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

module.exports = { findResidentAccount };
