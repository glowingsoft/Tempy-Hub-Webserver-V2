const {
  sendResponse,
  parsePaginationParams,
  validateParams,
} = require("@utils/responseUtil");
const visitorInvitationService = require("@adminServices/visitors/visitorInvitationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createVisitorInvitation = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["branchId", "arrivalAt", "visitingUntil"],
    })
  ) {
    return;
  }

  try {
    const data = await visitorInvitationService.createVisitorInvitation({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      externalPersonId: req.body.externalPersonId,
      visitorName: req.body.visitorName,
      visitorEmail: req.body.visitorEmail,
      hostStaffId: req.body.hostStaffId,
      arrivalAt: req.body.arrivalAt,
      visitingUntil: req.body.visitingUntil,
      badgeType: req.body.badgeType,
      instructions: req.body.instructions,
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

const listVisitorInvitations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await visitorInvitationService.listVisitorInvitations({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      status: req.query.status,
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

const resendVisitorInvitation = async (req, res) => {
  try {
    const data = await visitorInvitationService.resendVisitorInvitation({
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

module.exports = {
  createVisitorInvitation,
  listVisitorInvitations,
  resendVisitorInvitation,
};
