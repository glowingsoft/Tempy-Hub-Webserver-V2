const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const familyAccessService = require("@appServices/family/familyAccessService");
const familyCodeService = require("@appServices/family/familyCodeService");
const familyJoinService = require("@appServices/family/familyJoinService");
const familyMemberService = require("@appServices/family/familyMemberService");
const familyHandoverService = require("@appServices/family/familyHandoverService");
const familyInviteService = require("@appServices/family/familyInviteService");
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

const cancelJoinRequest = respond(
  (req) =>
    familyJoinService.cancelRequest({ userId: req.user._id, requestId: req.params.id }),
  { translationKey: "join_request_cancelled" }
);

const listJoinRequests = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyMemberService.listJoinRequests({ link: req.familyLink, page, limit, skip });
  },
  { paged: true }
);

const decideJoinRequest = (decision, translationKey) =>
  respond(
    (req) =>
      familyMemberService.decideJoinRequest({
        userId: req.user._id,
        requestId: req.params.id,
        decision,
      }),
    { translationKey }
  );

const approveJoinRequest = decideJoinRequest(FamilyMemberStatus.ACTIVE, "join_request_approved");
const rejectJoinRequest = decideJoinRequest(FamilyMemberStatus.REJECTED, "join_request_rejected");

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

const answerHandover = (action, translationKey) =>
  respond(
    (req) => action({ userId: req.user._id, handoverId: req.params.id }),
    { translationKey }
  );

const acceptHandover = answerHandover(familyHandoverService.acceptHandover, "handover_accepted");
const declineHandover = answerHandover(familyHandoverService.declineHandover, "handover_declined");
const cancelHandover = answerHandover(familyHandoverService.cancelHandover, "handover_cancelled");

const leaveFamily = respond(
  (req) => familyHandoverService.leaveFamily({ userId: req.user._id, link: req.familyLink }),
  { translationKey: "family_left" }
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
  cancelJoinRequest,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  listMembers,
  removeMember,
  listHandoverCandidates,
  requestHandover,
  getCurrentHandover,
  acceptHandover,
  declineHandover,
  cancelHandover,
  leaveFamily,
  inviteRelative,
};
