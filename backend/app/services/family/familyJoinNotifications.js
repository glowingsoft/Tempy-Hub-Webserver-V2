const { FamilyMember } = require("@models/FamilyMember");
const { NotificationTypes } = require("@models/Notifications");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { toObjectId } = require("./familyPipeline");
const { managersOf, familyOf, namesOf, notify, quietly } = require("./familyNotify");

const about = (link) => ({
  type: NotificationTypes.FAMILY_JOIN_REQUEST,
  objectId: link._id,
  objectType: "familyMember",
});

const notifyJoinRequested = ({ link, requesterName }) =>
  quietly(async () => {
    const { resident, home } = await namesOf(link);
    const [kin, managers] = await Promise.all([
      familyOf({ ...link, nextOfKinOnly: true }),
      managersOf(link),
    ]);
    await notify({
      ...about(link),
      receivers: [...kin, ...managers],
      subjectId: link.userId,
      title: "New join request",
      body: `${requesterName} asked to join ${resident}'s family at ${home}.`,
    });
  });

/** The person who asked is told how it was decided, whoever decided it. */
const notifyJoinDecided = ({ linkId, decision, actorId }) =>
  quietly(async () => {
    const [link] = await FamilyMember.aggregate([
      { $match: { _id: toObjectId(linkId) } },
      { $project: { userId: 1, residentId: 1, branchId: 1 } },
    ]);
    if (!link) return;

    const { resident, home } = await namesOf(link);
    const approved = decision === FamilyMemberStatus.ACTIVE;
    await notify({
      ...about(link),
      receivers: [link.userId],
      subjectId: actorId,
      title: approved ? "Request approved" : "Request declined",
      body: approved
        ? `You can now see ${resident}'s family at ${home}.`
        : `Your request to join ${resident}'s family was not approved.`,
    });
  });

module.exports = { notifyJoinRequested, notifyJoinDecided };
