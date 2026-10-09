const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const residentMediaService = require("@adminServices/residents/residentMediaService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listResidentMedia = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await residentMediaService.listResidentMedia({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      status: req.query.status,
      residentId: req.query.residentId,
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

const reviewResidentMedia = async (req, res) => {
  if (
    !validateParams(req, res, {
      objectIdFields: ["mediaId"],
      formFields: ["decision"],
      enumFields: {
        decision: ["approved", "rejected"],
      },
    })
  ) {
    return;
  }

  try {
    const data = await residentMediaService.reviewResidentMedia({
      actor: req.user,
      organizationId: req.orgId,
      mediaId: req.params.mediaId,
      decision: req.body.decision,
      reason: req.body.reason,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "resident_media_reviewed_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listResidentMedia,
  reviewResidentMedia,
};
