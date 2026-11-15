const moment = require("moment-timezone");
const { StaffProfile } = require("@models/StaffProfile");
const { Membership } = require("@models/Membership");
const { notify, quietly } = require("@appServices/family/familyNotify");
const { toObjectId } = require("@appServices/family/familyPipeline");
const {
  MembershipRole,
  ActiveInactiveStatus,
} = require("@models/domainEnums");

const DEFAULT_TZ = "Europe/London";

const dayOf = (date) => moment.utc(date).format("D MMM YYYY");

const whenOf = (date, timezone) =>
  moment.tz(date, timezone || DEFAULT_TZ).format("D MMM YYYY [at] HH:mm");

const notifyStaff = ({ staffId, ...notification }) =>
  quietly(async () => {
    const [staff] = await StaffProfile.aggregate([
      { $match: { _id: toObjectId(staffId) } },
      { $project: { userId: 1 } },
    ]);
    if (!staff?.userId) return;
    await notify({ receivers: [staff.userId], ...notification });
  });

const notifyOrgManagers = ({
  organizationId,
  branchId,
  extraUserIds = [],
  ...notification
}) =>
  quietly(async () => {
    const match = {
      organizationId: toObjectId(organizationId),
      status: ActiveInactiveStatus.ACTIVE,
      $or: [{ role: MembershipRole.OWNER }],
    };
    if (branchId) {
      match.$or.push({
        role: { $in: [MembershipRole.SITE_MANAGER, MembershipRole.LINE_MANAGER] },
        branchId: toObjectId(branchId),
      });
    }
    const managers = await Membership.distinct("userId", match);
    await notify({
      receivers: [...managers, ...extraUserIds],
      ...notification,
    });
  });

module.exports = { notifyStaff, notifyOrgManagers, dayOf, whenOf };
