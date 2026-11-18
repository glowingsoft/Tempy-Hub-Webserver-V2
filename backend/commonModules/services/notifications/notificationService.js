const moment = require("moment-timezone");
const {
  NotificationExp,
  NotificationTypes,
} = require("@models/Notifications");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const { getFullImageUrl } = require("@utils/imageHelper");

/** Own screens + APIs; still stored for push. */
const INBOX_EXCLUDED_OBJECT_TYPES = ["announcement"];
const INBOX_EXCLUDED_TYPES = [NotificationTypes.ANNOUNCEMENT];

const inboxMatch = (receiverId) => ({
  receiverId,
  objectType: { $nin: INBOX_EXCLUDED_OBJECT_TYPES },
  type: { $nin: INBOX_EXCLUDED_TYPES },
});

const getNotifications = async ({ receiverId, page, limit, timezone }) => {
  const match = inboxMatch(receiverId);
  const [notifications, totalNotifications, unread] = await Promise.all([
    NotificationExp.find(match)
      .populate("subjectId", "_id name profileIcon")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationExp.countDocuments(match),
    NotificationExp.countDocuments({ ...match, isRead: false }),
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
      subject: subjectId
        ? {
            _id: subjectId._id,
            name: subjectId.name || "",
            profileIcon: getFullImageUrl(subjectId.profileIcon),
          }
        : null,
      title,
      body,
      data: notificationData,
      isRead,
      timeSince: moment(createdAt).tz(userTimezone).fromNow(),
    };
  });

  return {
    data,
    meta: {
      ...generateMeta(page, limit, totalNotifications),
      unread,
    },
  };
};

const readNotification = async ({ notificationId, receiverId }) => {
  const notification = await NotificationExp.findOneAndUpdate(
    { _id: notificationId, receiverId },
    { isRead: true },
    { new: true }
  );

  if (!notification) {
    throw new AppError("notification_not_found", 404);
  }

  return notification;
};

const readAllNotifications = async ({ receiverId }) => {
  const result = await NotificationExp.updateMany(
    { ...inboxMatch(receiverId), isRead: false },
    { $set: { isRead: true, updatedAt: new Date() } },
  );

  return {
    unread: 0,
    marked: result.modifiedCount ?? 0,
  };
};

module.exports = {
  getNotifications,
  readNotification,
  readAllNotifications,
};
