const { parsePaginationParams, generateMeta } = require("@utils/responseUtil");
const { pipeline } = require("node:stream");
const { respond, respondByAction } = require("@utils/controllerResponse");
const { queryText } = require("@utils/familyQuery");
const familyAccessService = require("@appServices/family/familyAccessService");
const familyCodeService = require("@appServices/family/familyCodeService");
const familyJoinService = require("@appServices/family/familyJoinService");
const familyMemberService = require("@appServices/family/familyMemberService");
const familyHandoverService = require("@appServices/family/familyHandoverService");
const familyInviteService = require("@appServices/family/familyInviteService");
const familyUploadService = require("@appServices/family/familyUploadService");
const familyTimelineService = require("@appServices/family/familyTimelineService");
const familyGalleryService = require("@appServices/family/familyGalleryService");
const familyVisitService = require("@appServices/family/familyVisitService");
const familyHomeService = require("@appServices/family/familyHomeService");
const familyVisitPassService = require("@appServices/family/familyVisitPassService");
const familyWallService = require("@appServices/family/familyWallService");
const familyPreferenceService = require("@appServices/family/familyPreferenceService");
const familyInboxService = require("@appServices/family/familyInboxService");
const familyUploadScreenService = require("@appServices/family/familyUploadScreenService");
const familyHelpService = require("@appServices/family/familyHelpService");
const familyDataExportService = require("@appServices/family/familyDataExportService");
const familyNewsletterService = require("@appServices/family/familyNewsletterService");
const familyGazetteService = require("@appServices/family/familyGazetteService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { sendPdf } = require("@utils/familyPdfResponse");
const { FamilyMemberStatus } = require("@models/domainEnums");

const pagedDetail = (listKey, load) => {
  const whole = respond(load);
  const split = respond(
    async (req) => {
      const { page, limit, skip } = parsePaginationParams(req);
      const detail = await load(req);
      return {
        data: { ...detail, [listKey]: detail[listKey].slice(skip, skip + limit) },
        meta: generateMeta(page, limit, detail[listKey].length),
      };
    },
    { paged: true },
  );
  return (req, res) =>
    (req.query.page === undefined && req.query.limit === undefined ? whole : split)(req, res);
};

const listRelationships = respond(() =>
  familyAccessService.listRelationships(),
);

const getHome = respond((req) =>
  familyHomeService.getHome({
    user: req.user,
    residentId: queryText(req.query.residentId),
    tab: queryText(req.query.tab),
    paging: parsePaginationParams(req),
  }),
);

const listMyResidents = respond((req) =>
  familyAccessService.resolveFamilyResidents(req.user._id, {
    activeResidentId: queryText(req.query.residentId),
  }),
);

const getCurrentFamilyCode = respond((req) =>
  familyCodeService.getCurrentCode({ link: req.familyLink }),
);

const createFamilyCode = respond(
  (req) =>
    familyCodeService.createCode({
      link: req.familyLink,
      userId: req.user._id,
    }),
  { statusCode: 201, translationKey: "family_code_created" },
);

const previewJoinCode = respond((req) =>
  familyJoinService.previewCode({
    userId: req.user._id,
    code: queryText(req.query.code),
  }),
);

const requestToJoin = respond(
  (req) =>
    familyJoinService.requestToJoin({
      user: req.user,
      code: req.body.code,
      relationship: req.body.relationship,
    }),
  { statusCode: 201, translationKey: "join_request_created" },
);

const getCurrentJoinRequest = respond((req) =>
  familyJoinService.getCurrentRequest(req.user._id),
);

const listJoinRequests = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMemberService.listJoinRequests({
      link: req.familyLink,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const decide = (decision, translationKey) => ({
  run: (req) =>
    familyMemberService.decideJoinRequest({
      userId: req.user._id,
      requestId: req.params.id,
      decision,
    }),
  translationKey,
});

// The requester cancels their own request; the next of kin approves or rejects it.
const updateJoinRequest = respondByAction({
  approve: decide(FamilyMemberStatus.ACTIVE, "join_request_approved"),
  reject: decide(FamilyMemberStatus.REJECTED, "join_request_rejected"),
  cancel: {
    run: (req) =>
      familyJoinService.cancelRequest({
        userId: req.user._id,
        requestId: req.params.id,
      }),
    translationKey: "join_request_cancelled",
  },
});

const listMembers = respond((req) =>
  familyMemberService.listMembers({
    userId: req.user._id,
    link: req.familyLink,
    links: req.familyLinks,
  }),
);

const removeMember = respond(
  (req) =>
    familyMemberService.removeMember({
      userId: req.user._id,
      memberId: req.params.memberId,
    }),
  { translationKey: "family_member_removed" },
);

const listHandoverCandidates = respond((req) =>
  familyHandoverService.listCandidates({
    userId: req.user._id,
    link: req.familyLink,
  }),
);

const requestHandover = respond(
  (req) =>
    familyHandoverService.requestHandover({
      userId: req.user._id,
      link: req.familyLink,
      toMemberId: req.body.toMemberId,
      homeChooses: req.body.homeChooses,
    }),
  { statusCode: 201, translationKey: "handover_requested" },
);

const getCurrentHandover = respond((req) =>
  familyHandoverService.getCurrentHandover({
    userId: req.user._id,
    residentId: queryText(req.query.residentId),
  }),
);

const answerHandover = (answer, translationKey) => ({
  run: (req) => answer({ userId: req.user._id, handoverId: req.params.id }),
  translationKey,
});

const updateHandover = respondByAction({
  accept: answerHandover(
    familyHandoverService.acceptHandover,
    "handover_accepted",
  ),
  decline: answerHandover(
    familyHandoverService.declineHandover,
    "handover_declined",
  ),
  cancel: answerHandover(
    familyHandoverService.cancelHandover,
    "handover_cancelled",
  ),
});

const leaveFamily = respond(
  (req) =>
    familyHandoverService.leaveFamily({
      userId: req.user._id,
      link: req.familyLink,
    }),
  { translationKey: "family_left" },
);

const listSentInvitations = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyInviteService.listSentInvitations({
      userId: req.user._id,
      link: req.familyLink,
      status: queryText(req.query.status),
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const uploadPhoto = respond(
  (req) =>
    familyUploadService.uploadPhoto({ userId: req.user._id, file: req.file }),
  { statusCode: 201, translationKey: "photo_uploaded" },
);

const uploadPhotos = respond(
  (req) =>
    familyUploadService.uploadPhotos({
      userId: req.user._id,
      files: req.files,
    }),
  { statusCode: 201, translationKey: "photos_uploaded" },
);

// Form-data carries every field as text, so "false" and a single media id need reading as such.
const uploadFields = (req) => {
  const { mediaIds, includeInGazette } = req.body;
  if (!req.is("multipart/form-data")) return { mediaIds, includeInGazette };
  return {
    mediaIds:
      typeof mediaIds === "string"
        ? mediaIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : mediaIds,
    includeInGazette: String(includeInGazette).toLowerCase() === "true",
  };
};

const createUpload = respond(
  (req) =>
    familyUploadService.createUploadWithPhotos({
      userId: req.user._id,
      link: req.familyLink,
      message: req.body.message,
      clientId: req.body.clientId,
      files: req.files,
      ...uploadFields(req),
    }),
  { statusCode: 201, translationKey: "upload_sent_for_approval" },
);

const getNewUploadScreen = respond((req) =>
  familyUploadScreenService.getNewUpload({
    userId: req.user._id,
    link: req.familyLink,
  }),
);

const listMyUploads = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyUploadService.listMyUploads({
      userId: req.user._id,
      residentId: queryText(req.query.residentId),
      status: queryText(req.query.status),
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const deleteUpload = respond(
  (req) =>
    familyUploadService.deleteUpload({
      userId: req.user._id,
      links: req.familyLinks,
      uploadId: req.params.id,
    }),
  { translationKey: "upload_deleted" },
);

const updateUpload = respond(
  (req) =>
    familyUploadService.updateUpload({
      userId: req.user._id,
      links: req.familyLinks,
      uploadId: req.params.id,
      message: req.body.message,
      mediaIds: req.body.mediaIds,
      includeInGazette: req.body.includeInGazette,
    }),
  { translationKey: "upload_updated" },
);

const TIMELINE_PAGE_SIZE = 20;
const TIMELINE_MAX_PAGE_SIZE = 50;

const GALLERY_PAGE_SIZE = 30;
const GALLERY_MAX_PAGE_SIZE = 60;

const listGallery = respond(
  (req) => {
    const { page } = parsePaginationParams(req);
    const requested = parseInt(req.query.limit, 10);
    const limit =
      requested >= 1
        ? Math.min(requested, GALLERY_MAX_PAGE_SIZE)
        : GALLERY_PAGE_SIZE;
    return familyGalleryService.listGallery({
      link: req.familyLink,
      userId: req.user._id,
      tab: queryText(req.query.tab) || undefined,
      page,
      limit,
      skip: (page - 1) * limit,
    });
  },
  { paged: true },
);

const VISITS_PAGE_SIZE = 20;
const VISITS_MAX_PAGE_SIZE = 50;

const listVisits = respond(
  (req) => {
    const { page } = parsePaginationParams(req);
    const requested = parseInt(req.query.limit, 10);
    const limit =
      requested >= 1
        ? Math.min(requested, VISITS_MAX_PAGE_SIZE)
        : VISITS_PAGE_SIZE;
    return familyVisitService.listVisits({
      link: req.familyLink,
      userId: req.user._id,
      tab: queryText(req.query.tab) || undefined,
      page,
      limit,
      skip: (page - 1) * limit,
    });
  },
  { paged: true },
);

const getNextVisit = respond((req) =>
  familyVisitService.getNextVisit({
    link: req.familyLink,
    userId: req.user._id,
  }),
);

const getVisitOptions = respond((req) =>
  familyVisitService.getOptions({ link: req.familyLink }),
);

const requestVisit = respond(
  (req) =>
    familyVisitService.requestVisit({
      link: req.familyLink,
      user: req.user,
      body: req.body,
    }),
  { statusCode: 201, translationKey: "visit_requested" },
);

const answerVisit = (translationKey) => ({
  run: (req) =>
    familyVisitService.updateVisit({
      links: req.familyLinks,
      user: req.user,
      visitId: req.params.id,
      action: req.body.action,
    }),
  translationKey,
});

const updateVisit = respondByAction({
  [familyVisitService.VisitAction.CANCEL]: answerVisit("visit_cancelled"),
  [familyVisitService.VisitAction.GOING]: answerVisit("visit_reply_saved"),
  [familyVisitService.VisitAction.CANT_MAKE_IT]: answerVisit("visit_reply_saved"),
});

const getVisitPass = respond((req) =>
  familyVisitPassService.getPass({
    link: req.familyLink,
    userId: req.user._id,
  }),
);

const updateVisitPass = respond(
  (req) =>
    familyVisitPassService.updatePass({
      link: req.familyLink,
      userId: req.user._id,
      body: req.body,
    }),
  { translationKey: "visit_pass_saved" },
);

const listTimeline = respond(
  (req) => {
    const { page } = parsePaginationParams(req);
    const requested = parseInt(req.query.limit, 10);
    const limit =
      requested >= 1
        ? Math.min(requested, TIMELINE_MAX_PAGE_SIZE)
        : TIMELINE_PAGE_SIZE;
    return familyTimelineService.listTimeline({
      link: req.familyLink,
      userId: req.user._id,
      page,
      limit,
      skip: (page - 1) * limit,
    });
  },
  { paged: true },
);

// The Gazette screen in one call: the next issue, and a page of the printed ones (?page, ?limit).
const getNextGazette = respond(async (req) => {
  const { page, limit, skip } = parsePaginationParams(req);
  const link = req.familyLink;
  const [next, past] = await Promise.all([
    familyGazetteService.nextGazette({ link }),
    familyGazetteService.listGazettes({ link, page, limit, skip }),
  ]);
  return { ...next, pastGazettes: { items: past.data, meta: past.meta } };
});

const listGazettes = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyGazetteService.listGazettes({
      link: req.familyLink,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const getGazette = pagedDetail("messages", (req) =>
  familyGazetteService.getGazette({
    links: req.familyLinks,
    gazetteId: req.params.gazetteId,
  }),
);

const downloadGazettePdf = async (req, res) => {
  try {
    const pdf = await familyGazetteService.getPdf({
      links: req.familyLinks,
      gazetteId: req.params.gazetteId,
    });
    return await sendPdf({
      req,
      res,
      pdf,
      attachment: req.query.download !== "false",
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listNewsletters = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyNewsletterService.listNewsletters({
      link: req.familyLink,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const getNewsletter = pagedDetail("highlights", (req) =>
  familyNewsletterService.getNewsletter({
    links: req.familyLinks,
    newsletterId: req.params.newsletterId,
  }),
);

const downloadNewsletterPdf = async (req, res) => {
  try {
    const pdf = await familyNewsletterService.getPdf({
      links: req.familyLinks,
      newsletterId: req.params.newsletterId,
    });
    return await sendPdf({
      req,
      res,
      pdf,
      attachment: req.query.download !== "false",
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listWall = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyWallService.listWall({
      link: req.familyLink,
      links: req.familyLinks,
      userId: req.user._id,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const listPinnedPosts = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyWallService.listPinned({
      userId: req.user._id,
      links: req.familyLinks,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const setPostPinned = respond(
  (req) =>
    familyWallService.setPinned({
      userId: req.user._id,
      links: req.familyLinks,
      postId: req.params.postId,
      pinned: req.body.pinned,
    }),
  { translationKey: "post_pin_saved" },
);

const addReaction = respond(
  (req) =>
    familyWallService.addReaction({
      userId: req.user._id,
      links: req.familyLinks,
      postId: req.params.postId,
    }),
  { translationKey: "reaction_saved" },
);

const markPostsSeen = respond(
  (req) =>
    familyWallService.markSeen({
      userId: req.user._id,
      links: req.familyLinks,
      postIds: req.body.postIds,
    }),
  { translationKey: "posts_marked_seen" },
);

const reportPost = respond(
  (req) =>
    familyWallService.reportPost({
      userId: req.user._id,
      links: req.familyLinks,
      postId: req.params.postId,
      reason: req.body.reason,
    }),
  { statusCode: 201, translationKey: "post_reported" },
);

const removeReaction = respond(
  (req) =>
    familyWallService.removeReaction({
      userId: req.user._id,
      links: req.familyLinks,
      postId: req.params.postId,
    }),
  { translationKey: "reaction_removed" },
);

const inviteRelative = respond(
  (req) =>
    familyInviteService.inviteRelative({
      userId: req.user._id,
      link: req.familyLink,
      name: req.body.name,
      email: req.body.email,
      relationship: req.body.relationship,
    }),
  { statusCode: 201, translationKey: "invitation_sent_successfully" },
);

const getNotificationPreferences = respond((req) =>
  familyPreferenceService.getPreferences({ userId: req.user._id }),
);

const updateNotificationPreferences = respond(
  (req) =>
    familyPreferenceService.updatePreferences({
      userId: req.user._id,
      body: req.body,
    }),
  { translationKey: "notification_preferences_saved" },
);

const getDataRequest = respond((req) =>
  familyDataExportService.getState({ userId: req.user._id }),
);

const createDataRequest = respond(
  (req) => familyDataExportService.requestExport({ userId: req.user._id }),
  { statusCode: 201, translationKey: "data_request_created" },
);

const createDataDownload = respond((req) =>
  familyDataExportService.createDownloadLink({
    userId: req.user._id,
    password: req.body?.password,
    baseUrl: (
      process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, ""),
  }),
);

const downloadDataFile = async (req, res) => {
  try {
    const file = await familyDataExportService.openFile({
      token: req.params.token,
    });
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Content-Length": String(file.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    // a broken transfer closes the connection, so a partial file is never taken as complete
    return pipeline(file.stream, res, (error) => {
      if (error) console.error("family data download stopped", error.message);
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getHelp = respond((req) =>
  familyHelpService.getHelp({ link: req.familyLink }),
);

const listInboxMessages = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyInboxService.listInbox({
      userId: req.user._id,
      links: req.familyLinks,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const getInboxMessage = respond((req) =>
  familyInboxService.getMessage({
    userId: req.user._id,
    links: req.familyLinks,
    messageId: req.params.messageId,
  }),
);

module.exports = {
  listInboxMessages,
  getInboxMessage,
  getNewUploadScreen,
  getHelp,
  getDataRequest,
  createDataRequest,
  createDataDownload,
  downloadDataFile,
  getNotificationPreferences,
  updateNotificationPreferences,
  listRelationships,
  getNextGazette,
  listGazettes,
  getGazette,
  downloadGazettePdf,
  listNewsletters,
  getNewsletter,
  downloadNewsletterPdf,
  listMyResidents,
  getHome,
  getCurrentFamilyCode,
  createFamilyCode,
  previewJoinCode,
  requestToJoin,
  getCurrentJoinRequest,
  listJoinRequests,
  updateJoinRequest,
  listMembers,
  removeMember,
  listHandoverCandidates,
  requestHandover,
  getCurrentHandover,
  updateHandover,
  leaveFamily,
  inviteRelative,
  listSentInvitations,
  uploadPhoto,
  uploadPhotos,
  createUpload,
  listMyUploads,
  updateUpload,
  deleteUpload,
  listTimeline,
  listGallery,
  listVisits,
  getNextVisit,
  getVisitOptions,
  requestVisit,
  updateVisit,
  getVisitPass,
  updateVisitPass,
  listWall,
  listPinnedPosts,
  setPostPinned,
  addReaction,
  removeReaction,
  markPostsSeen,
  reportPost,
};
