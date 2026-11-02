const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const supervisionService = require("@adminServices/supervision/supervisionService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const mySupervision = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await supervisionService.mySupervision({
      actor: req.user,
      organizationId: req.orgId,
      timezone: req.query.timezone || req.user.timezone,
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

const getSupervision = async (req, res) => {
  try {
    const data = await supervisionService.getSupervision({
      actor: req.user,
      organizationId: req.orgId,
      supervisionId: req.params.supervisionId,
      timezone: req.query.timezone || req.user.timezone,
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

module.exports = { mySupervision, getSupervision };
