const { MembershipRole } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const residentAccess = require("@adminServices/residents/residentAccess");

const { actorStanding, assertBranchInOrganization } = residentAccess;

const assertMayAccessResidents = (standing, branchId) => {
  if (standing.role !== MembershipRole.STAFF)
    return residentAccess.assertMayAccessResidents(standing, branchId);
  if (!branchId || String(standing.branchId) !== String(branchId))
    throw new AppError("outside_managed_branch", 403);
};

const scopeBranchFilter = (standing, branchId) =>
  standing.role === MembershipRole.STAFF
    ? standing.branchId
    : residentAccess.scopeBranchFilter(standing, branchId);

module.exports = {
  actorStanding,
  assertBranchInOrganization,
  assertMayAccessResidents,
  scopeBranchFilter,
};
