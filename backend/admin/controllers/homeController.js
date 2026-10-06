const { sendResponse } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getHome = async (req, res) => {
  try {
    const data = [];
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

module.exports = {
  getHome,
};
