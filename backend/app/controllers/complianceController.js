const { sendResponse } = require("@utils/responseUtil");
const { myCompliance } = require("@adminServices/staff/staffComplianceService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getMyCompliance = async (req, res) => {
  try {
    const data = await myCompliance({
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

module.exports = { getMyCompliance };
