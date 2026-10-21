const { sendResponse } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");

/**
 * Wraps a handler so each one only says what to call and how to answer.
 * `paged` handlers return { data, meta } instead of plain data.
 */
const respond =
  (action, { statusCode = 200, translationKey = "data_fetched_successfully", paged = false } = {}) =>
  async (req, res) => {
    try {
      const result = await action(req);
      const body = paged ? { data: result.data, meta: result.meta } : { data: result };
      return sendResponse({ res, statusCode, translationKey, ...body });
    } catch (error) {
      return handleServiceError(res, error, "some_thing_went_wrong");
    }
  };

module.exports = { respond };
