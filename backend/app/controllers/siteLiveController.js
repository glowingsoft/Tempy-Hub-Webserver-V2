const { sendResponse } = require("@utils/responseUtil");
const siteLiveService = require("@adminServices/siteLive/siteLiveService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getSiteLive = async (req, res) => {
  try {
    const data = await siteLiveService.getSiteLive({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
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

module.exports = { getSiteLive };
