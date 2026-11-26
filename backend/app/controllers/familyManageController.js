const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const { queryId } = require("@utils/familyQuery");
const { branchFilter } = require("@middlewares/familyMiddleware");
const familyManageService = require("@adminServices/family/familyManageService");
const familyNewsletterService = require("@adminServices/family/familyNewsletterService");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { sendPdf } = require("@utils/familyPdfResponse");

const siteScope = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  branchId: branchFilter(req),
});

const bodySite = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  branchId: req.branchScope || queryId(req.body?.branchId, "branchId"),
});

const storyScope = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  branchScope: req.branchScope,
  newsletterId: req.params.id,
});

const getHome = respond((req) => familyManageService.getHome(siteScope(req)));

const getGazette = respond((req) =>
  familyManageService.getGazette({
    ...siteScope(req),
    ...parsePaginationParams(req),
  }),
);

const getGazetteDetail = respond((req) =>
  familyManageService.getGazetteDetail({
    organizationId: req.orgId,
    branchScope: req.branchScope,
    gazetteId: req.params.gazetteId,
    ...parsePaginationParams(req),
  }),
);

const listTagOptions = respond((req) =>
  familyManageService.listTagOptions(siteScope(req)),
);

const createPost = respond(
  (req) =>
    familyManageService.createPost({
      ...bodySite(req),
      title: req.body.title,
      message: req.body.message,
      status: req.body.status,
      scheduledAt: req.body.scheduledAt,
      mediaIds: req.body.mediaIds,
      taggedResidentIds: req.body.taggedResidentIds,
      audience: req.body.audience,
      isPinned: req.body.isPinned,
      addToNewsletter: req.body.addToNewsletter,
    }),
  { statusCode: 201, translationKey: "post_created" },
);

const getNewsletterScreen = respond((req) =>
  familyManageService.getNewsletterScreen(siteScope(req)),
);

const createNewsletter = respond(
  (req) =>
    familyManageService.createNewsletter({
      ...bodySite(req),
      month: req.body?.month,
      title: req.body?.title,
    }),
  { statusCode: 201, translationKey: "newsletter_created" },
);

const getStory = respond((req) =>
  familyManageService.getStory({
    ...storyScope(req),
    storyId: req.params.storyId,
  }),
);

const listAddablePosts = respond(
  (req) =>
    familyManageService.listAddablePosts({
      ...storyScope(req),
      ...parsePaginationParams(req),
    }),
  { paged: true },
);

const addStory = respond(
  (req) =>
    familyManageService.addStory({
      ...storyScope(req),
      postId: req.body.postId,
      headline: req.body.headline,
      story: req.body.story,
      mediaId: req.body.mediaId,
    }),
  { statusCode: 201, translationKey: "newsletter_updated" },
);

const updateStory = respond(
  (req) =>
    familyManageService.updateStory({
      ...storyScope(req),
      storyId: req.params.storyId,
      headline: req.body.headline,
      story: req.body.story,
      mediaId: req.body.mediaId,
    }),
  { translationKey: "newsletter_updated" },
);

const removeStory = respond(
  (req) =>
    familyManageService.removeStory({
      ...storyScope(req),
      storyId: req.params.storyId,
    }),
  { translationKey: "newsletter_updated" },
);

const getNewsletterPdf = async (req, res) => {
  try {
    const { newsletterId } = req.params;
    const pdf = await familyNewsletterService.getPdf({
      organizationId: req.orgId,
      branchId: req.branchScope,
      newsletterId,
    });
    if (req.query.format === "url" && !pdf.key) {
      const key = `family/newsletter-previews/${newsletterId}.pdf`;
      await uploadAwsService.putObject({ key, body: pdf.buffer, contentType: "application/pdf" });
      pdf.key = key;
    }
    return await sendPdf({
      req,
      res,
      pdf,
      attachment: req.query.download === "true",
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getNewsletterPdf,
  getHome,
  getGazette,
  getGazetteDetail,
  listTagOptions,
  createPost,
  getNewsletterScreen,
  createNewsletter,
  getStory,
  listAddablePosts,
  addStory,
  updateStory,
  removeStory,
};
