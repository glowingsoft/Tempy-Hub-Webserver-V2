const { Resident } = require("@models/Resident");
const { FamilyPostStatus } = require("@models/domainEnums");
const { toObjectId } = require("@appServices/family/familyPipeline");

/** BR-06: a resident with photo sharing off never appears in a newsletter or gazette, even if a post tagged them before. */
const everyTaggedResidentConsents = (sharedAsOf) => {
  const consents = { $eq: ["$$resident.photographyConsent", true] };
  const sharedBeforeStop = {
    $and: [
      { $eq: [{ $type: "$$resident.photoSharingStoppedAt" }, "date"] },
      { $lte: [sharedAsOf, "$$resident.photoSharingStoppedAt"] },
    ],
  };
  return {
    $expr: {
      $allElementsTrue: [
        {
          $map: {
            input: "$tagged",
            as: "resident",
            in: sharedAsOf ? { $or: [consents, sharedBeforeStop] } : consents,
          },
        },
      ],
    },
  };
};

/** The live posts of one site that are safe to reuse in a printed or sent document. */
const publishedPostsOfSite = ({
  organizationId,
  branchId,
  includeTagged = false,
  sharedAsOf = null,
}) => [
  {
    $match: {
      organizationId: toObjectId(organizationId),
      branchId: toObjectId(branchId),
      status: FamilyPostStatus.PUBLISHED,
      // A post for the families of tagged residents only is not for a document the whole site receives.
      ...(includeTagged ? {} : { audience: { $ne: "tagged" } }),
    },
  },
  {
    $lookup: {
      from: Resident.collection.name,
      localField: "taggedResidentIds",
      foreignField: "_id",
      as: "tagged",
    },
  },
  { $match: everyTaggedResidentConsents(sharedAsOf) },
];

module.exports = { everyTaggedResidentConsents, publishedPostsOfSite };
