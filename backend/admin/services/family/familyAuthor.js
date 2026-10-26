const { Membership } = require("@models/Membership");
const { MembershipRole } = require("@models/domainEnums");

const ROLE_LABELS = {
  [MembershipRole.OWNER]: "Owner",
  [MembershipRole.SUPER_ADMIN]: "Owner",
  [MembershipRole.SITE_MANAGER]: "Site Manager",
  [MembershipRole.LINE_MANAGER]: "Line Manager",
  [MembershipRole.STAFF]: "Staff",
};

/** Adds authorRole ("Site Manager") to rows that carry authorId and organizationId. */
const authorRoleStages = () => [
  {
    $lookup: {
      from: Membership.collection.name,
      let: { authorId: "$authorId", organizationId: "$organizationId" },
      pipeline: [
        {
          $match: {
            $expr: { $and: [{ $eq: ["$userId", "$$authorId"] }, { $eq: ["$organizationId", "$$organizationId"] }] },
          },
        },
        { $limit: 1 },
        { $project: { role: 1 } },
      ],
      as: "authorMembership",
    },
  },
  {
    $addFields: {
      authorRole: {
        $switch: {
          branches: Object.entries(ROLE_LABELS).map(([role, label]) => ({
            case: { $eq: [{ $arrayElemAt: ["$authorMembership.role", 0] }, role] },
            then: label,
          })),
          default: "",
        },
      },
    },
  },
];

module.exports = { authorRoleStages };
