const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const appraisalService = require("@adminServices/appraisal/appraisalService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const myAppraisal = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await appraisalService.myAppraisal({
      actor: req.user,
      organizationId: req.orgId,
      status: req.query.status,
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
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.getAppraisal({
      actor: req.user,
      organizationId: req.orgId,
      appraisalId: req.params.appraisalId,
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
      signatureUrl: req.body?.signatureUrl,
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

module.exports = { myAppraisal, getAppraisal, acknowledgeAppraisal };
