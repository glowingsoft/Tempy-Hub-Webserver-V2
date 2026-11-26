const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { toObjectId } = require("./familyPipeline");

const readableMatch = (links) => ({
  $or: [
    {
      branchId: {
        $in: links
          .filter((link) => link.isNextOfKin)
          .map((link) => toObjectId(link.branchId)),
      },
    },
    {
      forWholeFamily: true,
      residentIds: {
        $in: links.map((link) => toObjectId(link.residentId)),
      },
    },
  ],
});

const activeLinksOf = (userId) =>
  FamilyMember.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    { $project: { branchId: 1, residentId: 1, isNextOfKin: 1 } },
  ]);

module.exports = { readableMatch, activeLinksOf };
