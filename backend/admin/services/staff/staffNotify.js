const moment = require("moment-timezone");
const { StaffProfile } = require("@models/StaffProfile");
const { notify, quietly } = require("@appServices/family/familyNotify");
const { toObjectId } = require("@appServices/family/familyPipeline");

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

module.exports = { notifyStaff, dayOf, whenOf };
