const { sendResponse } = require("@utils/responseUtil");
const supervisionService = require("@adminServices/supervision/supervisionService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const mySupervision = async (req, res) => {
  try {
    const data = await supervisionService.mySupervision({
      actor: req.user,
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

module.exports = { mySupervision };
