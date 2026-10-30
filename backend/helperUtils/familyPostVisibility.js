const { FamilyPostAudience, FamilyPostStatus } = require("@models/domainEnums");
const { toObjectId } = require("@appServices/family/familyPipeline");

/**
 * Which published posts one family link may see, as a database match. A post with no audience saved is a branch
 * post, so every post made before audiences existed keeps showing exactly where it did.
 */
const visibleToLink = (link) => ({
  organizationId: toObjectId(link.organizationId),
  status: FamilyPostStatus.PUBLISHED,
  $or: [
    {
      audience: { $in: [FamilyPostAudience.BRANCH, null] },
      branchId: toObjectId(link.branchId),
    },
    { audience: FamilyPostAudience.ALL },
    {
      audience: FamilyPostAudience.TAGGED,
      taggedResidentIds: toObjectId(link.residentId),
    },
  ],
});

/** The posts any of the caller's links may see. */
const visibleToAny = (links) => ({
  status: FamilyPostStatus.PUBLISHED,
  $or: links.map((link) => {
    const { status, ...rest } = visibleToLink(link);
    return rest;
  }),
});

const AUDIENCE_LABELS = {
  [FamilyPostAudience.ALL]: "All families & residents",
  [FamilyPostAudience.TAGGED]: "Tagged resident families",
};

const audienceLabelOf = (audience, homeName) =>
  audience === FamilyPostAudience.BRANCH || !audience
    ? `${homeName || "Home"} families`
    : AUDIENCE_LABELS[audience];

module.exports = { visibleToLink, visibleToAny, audienceLabelOf };
