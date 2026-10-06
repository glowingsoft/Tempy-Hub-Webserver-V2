const { sendResponse } = require("@utils/responseUtil");
const homeService = require("@commonServices/home/homeService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getHome = async (req, res) => {
  try {
    const data = await homeService.getStaffHome({
      userId: req.user._id,
      organizationId: req.orgId,
      userName: req.user.name,
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

module.exports = {
  getHome,
};
