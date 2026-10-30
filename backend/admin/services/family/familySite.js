const { AppError } = require("@services/_errors/AppError");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
} = require("@adminServices/family/familyScope");

/**
 * The site staff are acting on: the one asked for, or their own. A site or line manager cannot
 * reach another site; an owner or super admin must say which one.
 */
const resolveSite = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const target = branchId || standing.branchId;
  if (!target) throw new AppError("branch_required", 400);

  assertMayAccessResidents(standing, target);
  await assertBranchInOrganization(target, organizationId);
  return { branchId: target, standing };
};

/** Same rule for something that already belongs to a site. */
const assertMayChangeSite = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayAccessResidents(standing, branchId);
  return standing;
};

module.exports = { resolveSite, assertMayChangeSite };
