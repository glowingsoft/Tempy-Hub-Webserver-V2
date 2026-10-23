const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const { queryText, queryId } = require("@utils/familyQuery");
const familyStaffService = require("@adminServices/family/familyStaffService");
const familyGroupService = require("@adminServices/family/familyGroupService");
const familyModerationService = require("@adminServices/family/familyModerationService");
const familyPostService = require("@adminServices/family/familyPostService");
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
      branchId: queryId(req.query.branchId),
      residentId: queryId(req.query.residentId),
      status: queryText(req.query.status),
      isNextOfKin: queryText(req.query.isNextOfKin),
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
      branchId: queryId(req.query.branchId),
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
      branchId: queryId(req.query.branchId),
      residentId: queryId(req.query.residentId),
      status: queryText(req.query.status),
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
      branchId: queryId(req.query.branchId),
      residentId: queryId(req.query.residentId),
      status: queryText(req.query.status),
      keyword: queryText(req.query.keyword),
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const getMember = respond((req) =>
  familyStaffService.getMember({ organizationId: req.orgId, memberId: req.params.memberId })
);

const listTaggableResidents = respond((req) =>
  familyPostService.listTaggableResidents({
    actor: req.user,
    organizationId: req.orgId,
    branchId: queryId(req.query.branchId),
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
      message: req.body.message,
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
      message: req.body.message,
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
      branchId: queryId(req.query.branchId),
      residentId: queryId(req.query.residentId),
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
      branchId: queryId(req.query.branchId),
      residentId: queryId(req.query.residentId),
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
  listFamilyGroups,
  listUploads,
  updateUpload,
  listPosts,
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
