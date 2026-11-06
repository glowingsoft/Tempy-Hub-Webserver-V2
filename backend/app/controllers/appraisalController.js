const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const appraisalService = require("@adminServices/appraisal/appraisalService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const myAppraisal = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const result = await appraisalService.myAppraisal({
      actor: req.user,
      organizationId: req.orgId,
      status: req.query.status,
      page,
      limit,
      skip,
      format: req.query.format,
    });

    if (result.csv != null) {
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.status(200).send(result.csv);
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: result.data,
      meta: result.meta,
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
