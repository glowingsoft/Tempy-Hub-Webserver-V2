const { Membership } = require("@models/Membership");
const { MembershipRole } = require("@models/domainEnums");

const ROLE_LABELS = {
  [MembershipRole.OWNER]: "Owner",
  [MembershipRole.SUPER_ADMIN]: "Owner",
  [MembershipRole.SITE_MANAGER]: "Site Manager",
  [MembershipRole.LINE_MANAGER]: "Line Manager",
  [MembershipRole.STAFF]: "Staff",
};

/** Adds a role label ("Site Manager") for the user in userField, as the field named output; rows need an organizationId. */
const authorRoleStages = ({
  userField = "authorId",
  output = "authorRole",
} = {}) => [
  {
    $lookup: {
      from: Membership.collection.name,
      let: { userId: `$${userField}`, organizationId: "$organizationId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$userId"] },
                { $eq: ["$organizationId", "$$organizationId"] },
              ],
            },
          },
        },
        { $limit: 1 },
        { $project: { role: 1 } },
      ],
      as: `${output}Membership`,
    },
  },
  {
    $addFields: {
      [output]: {
        $switch: {
          branches: Object.entries(ROLE_LABELS).map(([role, label]) => ({
            case: {
              $eq: [
                { $arrayElemAt: [`$${output}Membership.role`, 0] },
                role,
              ],
            },
            then: label,
          })),
          default: "",
        },
      },
    },
  },
];

module.exports = { authorRoleStages, ROLE_LABELS };
