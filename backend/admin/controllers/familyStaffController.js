const { parsePaginationParams } = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const familyStaffService = require("@adminServices/family/familyStaffService");
const familyGroupService = require("@adminServices/family/familyGroupService");
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
      branchId: req.query.branchId,
      residentId: req.query.residentId,
      status: req.query.status,
      isNextOfKin: req.query.isNextOfKin,
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
      branchId: req.query.branchId,
      status: req.query.status,
      keyword: req.query.keyword,
      page,
      limit,
      skip,
    });
  },
  { paged: true }
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
  listAllMembers,
  listFamilyGroups,
  setNextOfKin,
  removeMember,
  listJoinRequests,
  updateJoinRequest,
  listHandovers,
  getCode,
  createCode,
};
