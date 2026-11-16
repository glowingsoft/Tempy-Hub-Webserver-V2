const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { User } = require("@models/UserModel");
const { Membership } = require("@models/Membership");
const { FamilyMember } = require("@models/FamilyMember");
const { NotificationExp } = require("@models/Notifications");
const {
  ActiveInactiveStatus,
  FamilyMemberStatus,
  MembershipRole,
} = require("@models/domainEnums");
const { toObjectId } = require("./familyPipeline");

const CHUNK = 500;
const ANSWERING_ROLES = [MembershipRole.SITE_MANAGER, MembershipRole.LINE_MANAGER];

/** `preference` is a switch of the Notifications screen: a manager who turned it off is left out. */
const managersOf = async ({ organizationId, branchId }, preference) => {
  const rows = await Membership.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        role: { $in: ANSWERING_ROLES },
        status: ActiveInactiveStatus.ACTIVE,
      },
    },
    { $group: { _id: "$userId" } },
  ]);
  const managers = rows.map((row) => row._id);
  if (!preference || !managers.length) return managers;

  const muted = await User.aggregate([
    {
      $match: {
        _id: { $in: managers },
        [`notificationPreferences.${preference}`]: false,
      },
    },
    { $project: { _id: 1 } },
  ]);
  const off = new Set(muted.map((row) => String(row._id)));
  return managers.filter((id) => !off.has(String(id)));
};

const familyOf = async ({ organizationId, residentId, nextOfKinOnly = false }) => {
  const rows = await FamilyMember.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        residentId: toObjectId(residentId),
        status: FamilyMemberStatus.ACTIVE,
        ...(nextOfKinOnly ? { isNextOfKin: true } : {}),
      },
    },
    { $group: { _id: "$userId" } },
  ]);
  return rows.map((row) => row._id);
};

const nameOf = async (userId) => {
  const [user] = await User.aggregate([
    { $match: { _id: toObjectId(userId) } },
    { $project: { name: 1 } },
  ]);
  return user?.name || "A family member";
};

const namesOf = async ({ residentId, branchId }) => {
  const [[resident], [branch]] = await Promise.all([
    Resident.aggregate([
      { $match: { _id: toObjectId(residentId) } },
      { $project: { name: 1 } },
    ]),
    Branch.aggregate([
      { $match: { _id: toObjectId(branchId) } },
      { $project: { name: 1, timezone: 1 } },
    ]),
  ]);
  return {
    resident: resident?.name || "your relative",
    home: branch?.name || "the home",
    timezone: branch?.timezone || "Europe/London",
  };
};

/** One notification per person; the person who caused it is never told about their own action. */
const notify = async ({ receivers, ...notification }) => {
  const people = [...new Map(receivers.map((id) => [String(id), id])).values()].filter(
    (id) => String(id) !== String(notification.subjectId),
  );
  for (let i = 0; i < people.length; i += CHUNK) {
    await NotificationExp.insertMany(
      people.slice(i, i + CHUNK).map((receiverId) => ({ ...notification, receiverId })),
      { ordered: false },
    );
  }
};

/** A notification that cannot be built or saved never undoes the action it reports. */
const quietly = (work) =>
  work().catch((error) =>
    console.error("family notification failed", error.message),
  );

module.exports = { managersOf, familyOf, namesOf, nameOf, notify, quietly };
