const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { NotificationTypes } = require("@models/Notifications");
const { notify, quietly } = require("@appServices/family/familyNotify");

const notifyFamilies = ({ event }) =>
  quietly(async () => {
    const [branch] = await Branch.aggregate([
      { $match: { _id: event.branchId } },
      { $project: { name: 1, organizationId: 1 } },
    ]);
    if (!branch) return;
    const [organization] = await Organization.aggregate([
      { $match: { _id: branch.organizationId } },
      { $project: { notify: "$settings.emergencyNotifyOffsite" } },
    ]);
    if (!organization?.notify) return;

    const rows = await FamilyMember.aggregate([
      {
        $match: {
          branchId: event.branchId,
          status: FamilyMemberStatus.ACTIVE,
        },
      },
      { $group: { _id: "$userId" } },
    ]);
    await notify({
      receivers: rows.map((row) => row._id),
      type: NotificationTypes.FAMILY_EMERGENCY,
      subjectId: null,
      objectId: event._id,
      objectType: "evacuation",
      title: "Emergency at the home",
      body: `${branch.name} has started an evacuation. The home will contact you with more information.`,
    });
  });

module.exports = { notifyFamilies };
