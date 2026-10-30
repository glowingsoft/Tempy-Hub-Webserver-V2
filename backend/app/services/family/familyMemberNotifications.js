const { FamilyMember } = require("@models/FamilyMember");
const { NotificationTypes } = require("@models/Notifications");
const { toObjectId } = require("./familyPipeline");
const { namesOf, notify, quietly } = require("./familyNotify");

const MESSAGES = {
  paused: (resident, home) => [
    "Access paused",
    `Your access to ${resident}'s family at ${home} has been paused. Please contact the home if you have questions.`,
  ],
  removed: (resident, home) => [
    "Removed from family",
    `You have been removed from ${resident}'s family at ${home}.`,
  ],
};

const notifyAccessChanged = ({ linkId, change, actorId }) =>
  quietly(async () => {
    const [link] = await FamilyMember.aggregate([
      { $match: { _id: toObjectId(linkId) } },
      { $project: { userId: 1, residentId: 1, branchId: 1 } },
    ]);
    if (!link) return;

    const { resident, home } = await namesOf(link);
    const [title, body] = MESSAGES[change](resident, home);
    await notify({
      type: NotificationTypes.FAMILY_ACCESS,
      receivers: [link.userId],
      subjectId: actorId,
      objectId: link._id,
      objectType: "familyMember",
      title,
      body,
    });
  });

module.exports = { notifyAccessChanged };
