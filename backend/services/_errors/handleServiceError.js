const { sendResponse } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");

/**
 * Map service errors to sendResponse. Use in controller catch blocks.
 */
const isInvalidObjectId = (error) =>
  error?.name === "CastError" && error.kind === "ObjectId";

const handleServiceError = (res, error, fallbackKey = "an_error_9") => {
  if (error instanceof AppError) {
    return sendResponse({
      res,
      statusCode: error.statusCode,
      translationKey: error.translationKey,
      values: error.values,
      data: error.data,
      error,
    });
  }

  if (isInvalidObjectId(error)) {
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "invalid_id",
      error,
    });
  }

  return sendResponse({
    res,
    statusCode: 500,
    translationKey: fallbackKey,
    error,
  });
};

module.exports = { handleServiceError };
