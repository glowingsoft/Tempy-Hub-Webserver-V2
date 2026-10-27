const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const familyStaffService = require("@adminServices/family/familyStaffService");
const familyGroupService = require("@adminServices/family/familyGroupService");
const familyModerationService = require("@adminServices/family/familyModerationService");
const familyPostService = require("@adminServices/family/familyPostService");
const familyWallActivityService = require("@adminServices/family/familyWallActivityService");
const familyNewsletterService = require("@adminServices/family/familyNewsletterService");
const familySettingsService = require("@adminServices/family/familySettingsService");
const familyGazetteAdminService = require("@adminServices/family/familyGazetteAdminService");
const familyUploadService = require("@appServices/family/familyUploadService");
const familyAccessService = require("@appServices/family/familyAccessService");
const { FamilyMemberStatus } = require("@models/domainEnums");

const listGazettes = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyGazetteAdminService.listGazettes({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
      status: queryText(req.query.status),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const getGazette = respond((req) => familyGazetteAdminService.getGazette({ organizationId: req.orgId, itemId: req.params.itemId }));

const downloadGazettePdf = async (req, res) => {
  try {
    const { buffer, filename } = await familyGazetteAdminService.getPdf({ organizationId: req.orgId, itemId: req.params.itemId });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": buffer.length,
      "Content-Disposition": `${req.query.download === "true" ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return res.status(200).send(buffer);
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const downloadGazetteZip = async (req, res) => {
  try {
    const { entries, fileName } = await familyGazetteAdminService.downloadEntries({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
    });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return familyGazetteAdminService.zipStream(entries).pipe(res);
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const generateGazettes = respond(
  (req) => familyGazetteAdminService.generateForSite({ actor: req.user, organizationId: req.orgId, branchId: req.body.branchId }),
  { statusCode: 202, translationKey: "gazette_generation_started" }
);

const updateGazetteIssue = respondByAction({
  printed: {
    run: (req) => familyGazetteAdminService.printAll({ actor: req.user, organizationId: req.orgId, branchId: req.body.branchId, itemIds: req.body.itemIds }),
    translationKey: "gazette_marked_printed",
  },
  retry: {
    run: (req) => familyGazetteAdminService.retryIssue({ actor: req.user, organizationId: req.orgId, branchId: req.body.branchId }),
    translationKey: "gazette_retrying",
  },
});

const updateGazette = respondByAction({
  regenerate: {
    run: (req) =>
      familyGazetteAdminService.regenerate({
        actor: req.user,
        organizationId: req.orgId,
        itemId: req.params.itemId,
        removeUploadIds: req.body.removeUploadIds,
        uploadIds: req.body.uploadIds,
      }),
    translationKey: "gazette_regenerated",
  },
  printed: {
    run: (req) => familyGazetteAdminService.markPrinted({ actor: req.user, organizationId: req.orgId, itemId: req.params.itemId }),
    translationKey: "gazette_marked_printed",
  },
  given: {
    run: (req) => familyGazetteAdminService.markGiven({ actor: req.user, organizationId: req.orgId, itemId: req.params.itemId, givenOn: req.body.givenOn }),
    translationKey: "gazette_given_saved",
  },
});

const getSettings = respond((req) => familySettingsService.getSettings({ organizationId: req.orgId }));

const updateSettings = respond(
  (req) => familySettingsService.updateSettings({ actor: req.user, organizationId: req.orgId, gazette: req.body.gazette }),
  { translationKey: "family_settings_saved" }
);

const listRelationships = respond(() => familyAccessService.listRelationships());

const withScope = (req) => ({ actor: req.user, organizationId: req.orgId });

const listMembers = respond((req) =>
  familyStaffService.listMembers({ ...withScope(req), residentId: req.params.residentId })
);

const listAllMembers = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyStaffService.listAllMembers({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      status: queryText(req.query.status),
      isNextOfKin: queryText(req.query.isNextOfKin),
      keyword: queryText(req.query.keyword),
      days: queryText(req.query.days),
      audience: queryText(req.query.audience),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const listFamilyGroups = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyGroupService.listFamilyGroups({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
      status: queryText(req.query.status),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const getFamilyGroup = respond((req) =>
  familyGroupService.getFamilyGroup({ organizationId: req.orgId, residentId: req.params.residentId })
);

const listUploads = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyModerationService.listUploads({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      status: queryText(req.query.status),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const uploadScope = (req) => ({ actor: req.user, organizationId: req.orgId, uploadId: req.params.id });

const updateUpload = respondByAction({
  approve: {
    run: (req) => familyModerationService.approveUpload({ ...uploadScope(req), blur: req.body.blur }),
    translationKey: "upload_approved",
  },
  reject: {
    run: (req) => familyModerationService.rejectUpload({ ...uploadScope(req), reason: req.body.reason }),
    translationKey: "upload_rejected",
  },
});

const listPosts = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyPostService.listPosts({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      authorId: queryId(req.query.authorId, "authorId"),
      status: queryText(req.query.status),
      pinned: queryText(req.query.pinned),
      hasPhotos: queryText(req.query.hasPhotos),
      reported: queryText(req.query.reported),
      from: queryText(req.query.from),
      to: queryText(req.query.to),
      sort: queryText(req.query.sort),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const updateMember = respond(
  (req) =>
    familyStaffService.editMember({
      actor: req.user,
      organizationId: req.orgId,
      memberId: req.params.memberId,
      relationship: req.body.relationship,
    }),
  { translationKey: "family_member_updated" }
);

const updateMemberAccess = respondByAction({
  deactivate: {
    run: (req) =>
      familyStaffService.changeMemberAccess({ actor: req.user, organizationId: req.orgId, memberId: req.params.memberId, action: "deactivate" }),
    translationKey: "family_member_deactivated",
  },
  activate: {
    run: (req) =>
      familyStaffService.changeMemberAccess({ actor: req.user, organizationId: req.orgId, memberId: req.params.memberId, action: "activate" }),
    translationKey: "family_member_activated",
  },
});

const getMember = respond((req) =>
  familyStaffService.getMember({ organizationId: req.orgId, memberId: req.params.memberId })
);

const updatePostReports = respondByAction({
  dismiss: {
    run: (req) =>
      familyWallActivityService.dismissReports({ actor: req.user, organizationId: req.orgId, postId: req.params.id }),
    translationKey: "post_reports_dismissed",
  },
});

const listTaggableResidents = respond((req) =>
  familyPostService.listTaggableResidents({
    actor: req.user,
    organizationId: req.orgId,
    branchId: queryId(req.query.branchId, "branchId"),
  })
);

const uploadPostPhoto = respond(
  (req) => familyUploadService.uploadPhoto({ userId: req.user._id, file: req.file }),
  { statusCode: 201, translationKey: "photo_uploaded" }
);

const uploadPostPhotos = respond(
  (req) => familyUploadService.uploadPhotos({ userId: req.user._id, files: req.files }),
  { statusCode: 201, translationKey: "photos_uploaded" }
);

const createPost = respond(
  (req) =>
    familyPostService.createPost({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      title: req.body.title,
      message: req.body.message,
      status: req.body.status,
      scheduledAt: req.body.scheduledAt,
      mediaIds: req.body.mediaIds,
      taggedResidentIds: req.body.taggedResidentIds,
      audience: req.body.audience,
      isPinned: req.body.isPinned,
    }),
  { statusCode: 201, translationKey: "post_created" }
);

const updatePost = respond(
  (req) =>
    familyPostService.updatePost({
      actor: req.user,
      organizationId: req.orgId,
      postId: req.params.id,
      title: req.body.title,
      message: req.body.message,
      status: req.body.status,
      scheduledAt: req.body.scheduledAt,
      mediaIds: req.body.mediaIds,
      taggedResidentIds: req.body.taggedResidentIds,
      audience: req.body.audience,
      isPinned: req.body.isPinned,
    }),
  { translationKey: "post_updated" }
);

const removePost = respond(
  (req) => familyPostService.removePost({ actor: req.user, organizationId: req.orgId, postId: req.params.id }),
  { translationKey: "post_removed" }
);

const listNewsletters = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyNewsletterService.listNewsletters({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId),
      status: queryText(req.query.status),
      month: queryText(req.query.month),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const getNewsletter = respond((req) =>
  familyNewsletterService.getNewsletter({ organizationId: req.orgId, newsletterId: req.params.newsletterId })
);

const createNewsletter = respond(
  (req) =>
    familyNewsletterService.createDraft({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      month: req.body.month,
      title: req.body.title,
      template: req.body.template,
    }),
  { statusCode: 201, translationKey: "newsletter_created" }
);

const NEWSLETTER_FIELDS = ["title", "sections", "welcome", "highlights", "comingUp", "notices", "newResidentIds", "gallery", "footer", "delivery", "template", "refill"];

const updateNewsletter = respond(
  (req) =>
    familyNewsletterService.updateDraft({
      actor: req.user,
      organizationId: req.orgId,
      newsletterId: req.params.id,
      ...Object.fromEntries(NEWSLETTER_FIELDS.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]])),
    }),
  { translationKey: "newsletter_updated" }
);

const updateNewsletterDelivery = respondByAction({
  send: {
    run: (req) =>
      familyNewsletterService.sendNow({ actor: req.user, organizationId: req.orgId, newsletterId: req.params.id, delivery: req.body.delivery }),
    translationKey: "newsletter_sent",
  },
  schedule: {
    run: (req) =>
      familyNewsletterService.schedule({
        actor: req.user,
        organizationId: req.orgId,
        newsletterId: req.params.id,
        sendAt: req.body.sendAt,
        delivery: req.body.delivery,
      }),
    translationKey: "newsletter_scheduled",
  },
  cancel: {
    run: (req) => familyNewsletterService.cancelSchedule({ actor: req.user, organizationId: req.orgId, newsletterId: req.params.id }),
    translationKey: "newsletter_schedule_cancelled",
  },
});

const downloadNewsletterPdf = async (req, res) => {
  try {
    const { buffer, filename } = await familyNewsletterService.getPdf({ organizationId: req.orgId, newsletterId: req.params.newsletterId });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": buffer.length,
      "Content-Disposition": `${req.query.download === "true" ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return res.status(200).send(buffer);
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const removeNewsletter = respond(
  (req) => familyNewsletterService.deleteDraft({ actor: req.user, organizationId: req.orgId, newsletterId: req.params.id }),
  { translationKey: "newsletter_removed" }
);

const setNextOfKin = respond(
  (req) =>
    familyStaffService.setNextOfKin({
      ...withScope(req),
      residentId: req.params.residentId,
      memberId: req.body.memberId,
    }),
  { translationKey: "next_of_kin_set" }
);

const removeMember = respond(
  (req) =>
    familyStaffService.removeMember({
      ...withScope(req),
      residentId: req.params.residentId,
      memberId: req.params.memberId,
    }),
  { translationKey: "family_member_removed" }
);

const listJoinRequests = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyStaffService.listJoinRequests({
      ...withScope(req),
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const decide = (decision, translationKey) => ({
  run: (req) =>
    familyStaffService.decideJoinRequest({
      ...withScope(req),
      requestId: req.params.id,
      decision,
    }),
  translationKey,
});

const updateJoinRequest = respondByAction({
  approve: decide(FamilyMemberStatus.ACTIVE, "join_request_approved"),
  reject: decide(FamilyMemberStatus.REJECTED, "join_request_rejected"),
});

const listHandovers = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyStaffService.listHandovers({
      ...withScope(req),
      branchId: queryId(req.query.branchId, "branchId"),
      residentId: queryId(req.query.residentId, "residentId"),
      homeChooses: queryText(req.query.homeChooses),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const getCode = respond((req) =>
  familyStaffService.getCode({ ...withScope(req), residentId: req.params.residentId })
);

const createCode = respond(
  (req) => familyStaffService.createCode({ ...withScope(req), residentId: req.params.residentId }),
  { statusCode: 201, translationKey: "family_code_created" }
);

module.exports = {
  listGazettes,
  getGazette,
  downloadGazettePdf,
  downloadGazetteZip,
  generateGazettes,
  updateGazetteIssue,
  updateGazette,
  getSettings,
  updateSettings,
  listRelationships,
  listMembers,
  listAllMembers,
  getMember,
  updateMember,
  updateMemberAccess,
  listFamilyGroups,
  getFamilyGroup,
  listUploads,
  updateUpload,
  listPosts,
  updatePostReports,
  listNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletter,
  updateNewsletterDelivery,
  downloadNewsletterPdf,
  removeNewsletter,
  listTaggableResidents,
  uploadPostPhoto,
  uploadPostPhotos,
  createPost,
  updatePost,
  removePost,
  setNextOfKin,
  removeMember,
  listJoinRequests,
  updateJoinRequest,
  listHandovers,
  getCode,
  createCode,
};
