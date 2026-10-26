const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const familyStaffService = require("@adminServices/family/familyStaffService");
const familyGroupService = require("@adminServices/family/familyGroupService");
const familyModerationService = require("@adminServices/family/familyModerationService");
const familyPostService = require("@adminServices/family/familyPostService");
const familyWallActivityService = require("@adminServices/family/familyWallActivityService");
const familyUploadService = require("@appServices/family/familyUploadService");
const { FamilyMemberStatus } = require("@models/domainEnums");

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
      phone: req.body.phone,
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
      isPinned: req.body.isPinned,
    }),
  { translationKey: "post_updated" }
);

const removePost = respond(
  (req) => familyPostService.removePost({ actor: req.user, organizationId: req.orgId, postId: req.params.id }),
  { translationKey: "post_removed" }
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
  listMembers,
  listAllMembers,
  getMember,
  updateMember,
  updateMemberAccess,
  listFamilyGroups,
  listUploads,
  updateUpload,
  listPosts,
  updatePostReports,
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
