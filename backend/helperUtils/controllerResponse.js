const { sendResponse } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
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

/**
 * One route for the actions on a record: the body's `action` picks the handler, so
 * approve / reject / cancel share one PUT. Unknown actions are a 400.
 * `actions` maps a name to { run(req), translationKey?, statusCode? }.
 */
const respondByAction = (actions) => async (req, res) => {
  const action = String(req.body?.action || "");
  const handler = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
  if (!handler) {
    return handleServiceError(res, new AppError("invalid_action", 400, { actions: Object.keys(actions).join(", ") }), "some_thing_went_wrong");
  }
  return respond(handler.run, handler)(req, res);
};

module.exports = { respond, respondByAction };
