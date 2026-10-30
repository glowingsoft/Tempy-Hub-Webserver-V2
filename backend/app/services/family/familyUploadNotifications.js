const { NotificationTypes } = require("@models/Notifications");
const { managersOf, namesOf, nameOf, notify, quietly } = require("./familyNotify");

const describe = ({ message, mediaIds }) => {
  if (!mediaIds.length) return "a message";
  if (message) return "photos and a message";
  return mediaIds.length === 1 ? "a photo" : "photos";
};

const notifyUploadWaiting = ({ upload }) =>
  quietly(async () => {
    const [author, { resident }, managers] = await Promise.all([
      nameOf(upload.authorId),
      namesOf(upload),
      managersOf(upload),
    ]);
    await notify({
      type: NotificationTypes.FAMILY_UPLOAD_PENDING,
      receivers: managers,
      subjectId: upload.authorId,
      objectId: upload._id,
      objectType: "familyUpload",
      title: "New upload to review",
      body: `${author} shared ${describe(upload)} about ${resident}.`,
    });
  });

module.exports = { notifyUploadWaiting };
