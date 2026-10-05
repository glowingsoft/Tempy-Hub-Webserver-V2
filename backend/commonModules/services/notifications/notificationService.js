const moment = require("moment-timezone");
const { NotificationExp } = require("@models/Notifications");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");

const getNotifications = async ({ receiverId, page, limit, timezone }) => {
  const [notifications, totalNotifications] = await Promise.all([
    NotificationExp.find({ receiverId })
      .populate("subjectId", "_id name profileIcon")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    NotificationExp.countDocuments({ receiverId }),
  ]);

  const userTimezone = timezone || "UTC";
  const data = notifications.map((notification) => {
    const {
      _id,
      type,
      objectId,
      title,
      body,
      data: notificationData,
      isRead,
      createdAt,
      objectType,
      subjectId,
    } = notification;

    return {
      _id,
      type,
      objectId,
      objectType,
      subject: subjectId,
      title,
      body,
      data: notificationData,
      isRead,
      timeSince: moment(createdAt).tz(userTimezone).fromNow(),
    };
  });

  return {
    data,
    meta: generateMeta(page, limit, totalNotifications),
  };
};

const readNotification = async ({ notificationId }) => {
  const notification = await NotificationExp.findByIdAndUpdate(
    notificationId,
    { isRead: true },
    { new: true }
  );

  if (!notification) {
    throw new AppError("notification_not_found", 404);
  }

  return notification;
};

module.exports = {
  getNotifications,
  readNotification,
};
