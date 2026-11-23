const { respond } = require("@utils/controllerResponse");
const familyPostService = require("@adminServices/family/familyPostService");

const setPinned = respond(
  (req) =>
    familyPostService.setPinned({
      actor: req.user,
      organizationId: req.orgId,
      postId: req.params.postId,
      pinned: req.body.pinned,
    }),
  { translationKey: "post_updated" },
);

module.exports = { setPinned };
