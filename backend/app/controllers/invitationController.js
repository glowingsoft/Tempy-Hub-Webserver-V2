const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const membershipService = require("@adminServices/organizations/membershipService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listMyInvitations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await membershipService.listMyInvitations({
      user: req.user,
      page,
      limit,
      skip,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const getMyInvitation = async (req, res) => {
  try {
    const data = await membershipService.getMyInvitation({
      user: req.user,
      invitationId: req.params.invitationId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const acceptMyInvitation = async (req, res) => {
  try {
    const data = await membershipService.acceptMyInvitation({
      user: req.user,
      invitationId: req.params.invitationId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_accepted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

module.exports = {
  listMyInvitations,
  getMyInvitation,
  acceptMyInvitation,
};
