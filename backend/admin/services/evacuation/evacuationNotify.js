const { FamilyMember } = require("@models/FamilyMember");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { Membership } = require("@models/Membership");
const {
  FamilyMemberStatus,
  ActiveInactiveStatus,
  AdmissionStatus,
  EvacuationType,
  MembershipRole,
} = require("@models/domainEnums");
const { NotificationTypes } = require("@models/Notifications");
const {
  sendUserNotifications,
} = require("@commonServices/communication/communicationService");
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

const alertEvacuation = async ({
  receivers,
  senderId,
  eventId,
  title,
  body,
  data = {},
}) => {
  if (!receivers.length) return 0;
  await notify({
    receivers,
    type: NotificationTypes.EVACUATION_ALERT,
    subjectId: senderId,
    objectId: eventId,
    objectType: "evacuation",
    title,
    body,
  });
  await sendUserNotifications({
    recipientIds: receivers,
    title,
    body,
    sender: senderId,
    objectId: eventId,
    saveNotification: false,
    data: {
      type: NotificationTypes.EVACUATION_ALERT,
      objectType: "evacuation",
      objectId: String(eventId),
      ...data,
    },
  });
  return receivers.length;
};

const alertResidentsOfEvacuation = async ({ event }) => {
  try {
    const [receivers, branch] = await Promise.all([
      Resident.distinct("userId", {
        branchId: event.branchId,
        admissionStatus: AdmissionStatus.ADMITTED,
        userId: { $type: "objectId" },
      }),
      Branch.findById(event.branchId).select("name").lean(),
    ]);
    const real = event.type === EvacuationType.REAL;
    const place = branch?.name || "your home";
    return await alertEvacuation({
      receivers,
      senderId: event.startedByUserId || null,
      eventId: event._id,
      title: real ? "Fire Emergency" : "Fire Drill",
      body: `${real ? `Fire alarm at ${place}.` : `A fire drill has started at ${place}.`} Follow staff instructions, then open the app to say if you are OK or need help.`,
    });
  } catch (error) {
    console.error("resident evacuation alert failed", error.message);
    return 0;
  }
};

const alertStaffResidentNeedsHelp = async ({ event, resident, userId }) => {
  try {
    const receivers = await Membership.distinct("userId", {
      organizationId: resident.organizationId,
      status: ActiveInactiveStatus.ACTIVE,
      userId: { $ne: userId },
      $or: [
        { branchId: event.branchId },
        { role: { $in: [MembershipRole.OWNER, MembershipRole.SUPER_ADMIN] } },
      ],
    });
    const real = event.type === EvacuationType.REAL;
    const room = resident.roomNumber ? ` (Room ${resident.roomNumber})` : "";
    return await alertEvacuation({
      receivers,
      senderId: userId,
      eventId: event._id,
      title: "Resident needs help",
      body: `${resident.name}${room} needs help during the ${real ? "fire emergency" : "fire drill"} at ${resident.branchName || "your home"}.`,
      data: { residentId: String(resident.residentId) },
    });
  } catch (error) {
    console.error("resident help alert failed", error.message);
    return 0;
  }
};

module.exports = {
  sendFamilyMessage,
  countFamilies,
  alertResidentsOfEvacuation,
  alertStaffResidentNeedsHelp,
};
