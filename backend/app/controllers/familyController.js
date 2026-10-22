const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const familyAccessService = require("@appServices/family/familyAccessService");
const familyCodeService = require("@appServices/family/familyCodeService");
const familyJoinService = require("@appServices/family/familyJoinService");
const familyMemberService = require("@appServices/family/familyMemberService");
const familyHandoverService = require("@appServices/family/familyHandoverService");
const familyInviteService = require("@appServices/family/familyInviteService");
const familyUploadService = require("@appServices/family/familyUploadService");
const { FamilyMemberStatus } = require("@models/domainEnums");

const listRelationships = respond(() => familyAccessService.listRelationships());

const listMyResidents = respond((req) =>
  familyAccessService.resolveFamilyResidents(req.user._id, {
    activeResidentId: req.query.residentId,
  })
);

const getCurrentFamilyCode = respond((req) =>
  familyCodeService.getCurrentCode({ link: req.familyLink })
);

const createFamilyCode = respond(
  (req) => familyCodeService.createCode({ link: req.familyLink, userId: req.user._id }),
  { statusCode: 201, translationKey: "family_code_created" }
);

const previewJoinCode = respond((req) =>
  familyJoinService.previewCode({ userId: req.user._id, code: req.query.code })
);

const requestToJoin = respond(
  (req) =>
    familyJoinService.requestToJoin({
      user: req.user,
      code: req.body.code,
      relationship: req.body.relationship,
    }),
  { statusCode: 201, translationKey: "join_request_created" }
);

const getCurrentJoinRequest = respond((req) =>
  familyJoinService.getCurrentRequest(req.user._id)
);

const listJoinRequests = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMemberService.listJoinRequests({ link: req.familyLink, page, limit, skip });
  },
  { paged: true }
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
      familyJoinService.cancelRequest({ userId: req.user._id, requestId: req.params.id }),
    translationKey: "join_request_cancelled",
  },
});

const listMembers = respond((req) =>
  familyMemberService.listMembers({ userId: req.user._id, link: req.familyLink })
);

const removeMember = respond(
  (req) =>
    familyMemberService.removeMember({ userId: req.user._id, memberId: req.params.memberId }),
  { translationKey: "family_member_removed" }
);

const listHandoverCandidates = respond((req) =>
  familyHandoverService.listCandidates({ userId: req.user._id, link: req.familyLink })
);

const requestHandover = respond(
  (req) =>
    familyHandoverService.requestHandover({
      userId: req.user._id,
      link: req.familyLink,
      toMemberId: req.body.toMemberId,
      homeChooses: req.body.homeChooses,
    }),
  { statusCode: 201, translationKey: "handover_requested" }
);

const getCurrentHandover = respond((req) =>
  familyHandoverService.getCurrentHandover({
    userId: req.user._id,
    residentId: req.query.residentId,
  })
);

const answerHandover = (answer, translationKey) => ({
  run: (req) => answer({ userId: req.user._id, handoverId: req.params.id }),
  translationKey,
});

const updateHandover = respondByAction({
  accept: answerHandover(familyHandoverService.acceptHandover, "handover_accepted"),
  decline: answerHandover(familyHandoverService.declineHandover, "handover_declined"),
  cancel: answerHandover(familyHandoverService.cancelHandover, "handover_cancelled"),
});

const leaveFamily = respond(
  (req) => familyHandoverService.leaveFamily({ userId: req.user._id, link: req.familyLink }),
  { translationKey: "family_left" }
);

const listSentInvitations = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyInviteService.listSentInvitations({
      userId: req.user._id,
      link: req.familyLink,
      status: req.query.status,
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const uploadPhoto = respond(
  (req) => familyUploadService.uploadPhoto({ userId: req.user._id, file: req.file }),
  { statusCode: 201, translationKey: "photo_uploaded" }
);

const createUpload = respond(
  (req) =>
    familyUploadService.createUpload({
      userId: req.user._id,
      link: req.familyLink,
      message: req.body.message,
      mediaIds: req.body.mediaIds,
      includeInGazette: req.body.includeInGazette,
      clientId: req.body.clientId,
    }),
  { statusCode: 201, translationKey: "upload_sent_for_approval" }
);

const listMyUploads = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyUploadService.listMyUploads({
      userId: req.user._id,
      residentId: req.query.residentId,
      status: req.query.status,
      page,
      limit,
      skip,
    });
  },
  { paged: true }
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
  { translationKey: "upload_updated" }
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
  { statusCode: 201, translationKey: "invitation_sent_successfully" }
);

module.exports = {
  listRelationships,
  listMyResidents,
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
  createUpload,
  listMyUploads,
  updateUpload,
};
