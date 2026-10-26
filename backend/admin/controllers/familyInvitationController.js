const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const { respond, respondByAction } = require("@utils/controllerResponse");
const familyService = require("@adminServices/family/familyService");
const { queryText, queryId } = require("@utils/familyQuery");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { FamilyRelationship } = require("@models/domainEnums");

const inviteFamilyMember = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["email", "residentId"],
      objectIdFields: ["residentId"],
      enumFields: { relationship: Object.values(FamilyRelationship) },
    })
  ) {
    return;
  }

  try {
    const data = await familyService.inviteFamilyMember({
      actor: req.user,
      organizationId: req.params.organizationId || req.orgId,
      residentId: req.body.residentId,
      email: req.body.email,
      name: req.body.name,
      phone: req.body.phone,
      relationship: req.body.relationship,
      isNextOfKin: req.body.isNextOfKin,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "invitation_sent_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listInvitations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await familyService.listInvitations({
      organizationId: req.orgId,
      branchId: queryId(req.query.branchId),
      page,
      limit,
      skip,
      status: queryText(req.query.status),
      residentId: queryId(req.query.residentId),
      keyword: queryText(req.query.keyword),
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getInvitation = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["invitationId"] })) return;

  try {
    const data = await familyService.getInvitation({
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const invitationAction = (run, translationKey) => ({
  run: (req) =>
    run({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    }),
  translationKey,
});

const updateInvitation = respondByAction({
  resend: invitationAction(familyService.resendInvitation, "invitation_sent_successfully"),
  revoke: invitationAction(familyService.revokeInvitation, "invitation_revoked_successfully"),
  edit: {
    run: (req) =>
      familyService.editInvitation({
        actor: req.user,
        invitationId: req.params.invitationId,
        organizationId: req.orgId,
        name: req.body.name,
        phone: req.body.phone,
        relationship: req.body.relationship,
      }),
    translationKey: "invitation_updated",
  },
});

const deleteInvitation = respond(
  (req) =>
    familyService.deleteInvitation({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    }),
  { translationKey: "invitation_deleted" }
);

module.exports = {
  inviteFamilyMember,
  listInvitations,
  getInvitation,
  updateInvitation,
  deleteInvitation,
};
