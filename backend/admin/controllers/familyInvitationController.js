const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const familyService = require("@adminServices/family/familyService");
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
      isPrimaryContact: req.body.isPrimaryContact,
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
      page,
      limit,
      skip,
      status: req.query.status,
      residentId: req.query.residentId,
      keyword: req.query.keyword,
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

const resendInvitation = async (req, res) => {
  try {
    const data = await familyService.resendInvitation({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_sent_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const revokeInvitation = async (req, res) => {
  try {
    const data = await familyService.revokeInvitation({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_revoked_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  inviteFamilyMember,
  listInvitations,
  getInvitation,
  resendInvitation,
  revokeInvitation,
};
