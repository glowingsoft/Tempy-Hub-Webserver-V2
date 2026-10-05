const {
  sendResponse,
  parsePaginationParams,
} = require("@utils/responseUtil");
const notificationService = require("@commonServices/notifications/notificationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getNotifications = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);

  try {
    const { data, meta } = await notificationService.getNotifications({
      receiverId: req.user._id,
      page,
      limit,
      timezone: req.user.timezone,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "notifications_fetched_success",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "notifications_fetch_error");
  }
};

const readNotification = async (req, res) => {
  try {
    const data = await notificationService.readNotification({
      notificationId: req.params.id,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "notification_marked_read_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "notification_mark_read_error");
  }
};

module.exports = {
  getNotifications,
  readNotification,
};
