const { parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const familyStaffService = require("@adminServices/family/familyStaffService");
const { FamilyMemberStatus } = require("@models/domainEnums");

const withScope = (req) => ({ actor: req.user, organizationId: req.orgId });

const listMembers = respond((req) =>
  familyStaffService.listMembers({ ...withScope(req), residentId: req.params.residentId })
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
      branchId: req.query.branchId,
      residentId: req.query.residentId,
      page,
      limit,
      skip,
    });
  },
  { paged: true }
);

const decideJoinRequest = (decision, translationKey) =>
  respond(
    (req) =>
      familyStaffService.decideJoinRequest({
        ...withScope(req),
        requestId: req.params.id,
        decision,
      }),
    { translationKey }
  );

const approveJoinRequest = decideJoinRequest(FamilyMemberStatus.ACTIVE, "join_request_approved");
const rejectJoinRequest = decideJoinRequest(FamilyMemberStatus.REJECTED, "join_request_rejected");

const listHandovers = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return familyStaffService.listHandovers({
      ...withScope(req),
      branchId: req.query.branchId,
      residentId: req.query.residentId,
      homeChooses: req.query.homeChooses,
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
  setNextOfKin,
  removeMember,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  listHandovers,
  getCode,
  createCode,
};
