const {
  sendResponse,
  parsePaginationParams,
  validateParams,
} = require("@utils/responseUtil");
const visitorAccountInvitationService = require("@adminServices/visitors/visitorAccountInvitationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listVisitorAccountInvitations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await visitorAccountInvitationService.listVisitorAccountInvitations({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      status: req.query.status,
      type: req.query.type,
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

const createVisitorAccountInvitation = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["branchId", "email", "type"],
    })
  ) {
    return;
  }

  try {
    const data = await visitorAccountInvitationService.createVisitorAccountInvitation({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      email: req.body.email,
      name: req.body.name,
      type: req.body.type,
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

const resendVisitorAccountInvitation = async (req, res) => {
  try {
    const data = await visitorAccountInvitationService.resendVisitorAccountInvitation({
      actor: req.user,
      organizationId: req.orgId,
      invitationId: req.params.invitationId,
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

const revokeVisitorAccountInvitation = async (req, res) => {
  try {
    const data = await visitorAccountInvitationService.revokeVisitorAccountInvitation({
      actor: req.user,
      organizationId: req.orgId,
      invitationId: req.params.invitationId,
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

const previewVisitorAccountInvitation = async (req, res) => {
  try {
    const data = await visitorAccountInvitationService.previewVisitorAccountInvitation({
      token: req.params.token,
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

const acceptVisitorAccountInvitation = async (req, res) => {
  try {
    const data = await visitorAccountInvitationService.acceptVisitorAccountInvitation({
      token: req.params.token,
      name: req.body.name,
      password: req.body.password,
      timezone: req.body.timezone,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_accepted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listVisitorAccountInvitations,
  createVisitorAccountInvitation,
  resendVisitorAccountInvitation,
  revokeVisitorAccountInvitation,
  previewVisitorAccountInvitation,
  acceptVisitorAccountInvitation,
};
