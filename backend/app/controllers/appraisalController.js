const { sendResponse } = require("@utils/responseUtil");
const appraisalService = require("@adminServices/appraisal/appraisalService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const myAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.myAppraisal({
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

const acknowledgeAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.acknowledgeAppraisal({
      actor: req.user,
      organizationId: req.orgId,
      appraisalId: req.params.appraisalId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "appraisal_acknowledged",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { myAppraisal, acknowledgeAppraisal };
