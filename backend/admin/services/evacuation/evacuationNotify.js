const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { NotificationTypes } = require("@models/Notifications");
const { notify } = require("@appServices/family/familyNotify");

const familyRecipients = async (branchId) => {
  const rows = await FamilyMember.aggregate([
    { $match: { branchId, status: FamilyMemberStatus.ACTIVE } },
    { $group: { _id: "$userId" } },
  ]);
  return rows.map((row) => row._id);
};

const countFamilies = async (branchId) => (await familyRecipients(branchId)).length;

const sendFamilyMessage = async ({ event, actor, title, body }) => {
  const receivers = await familyRecipients(event.branchId);
  await notify({
    receivers,
    type: NotificationTypes.FAMILY_EMERGENCY,
    subjectId: actor?._id || null,
    objectId: event._id,
    objectType: "evacuation",
    title,
    body,
  });
  return receivers.length;
};

module.exports = { sendFamilyMessage, countFamilies };
