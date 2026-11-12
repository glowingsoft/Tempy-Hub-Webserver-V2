const { StaffProfile } = require("@models/StaffProfile");
const { ExternalPerson } = require("@models/ExternalPerson");

const queue = (Model, id, missedSignInAt) =>
  Model.updateOne(
    { _id: id },
    {
      $set: {
        "signOutReminder.pending": true,
        "signOutReminder.missedSignInAt": missedSignInAt,
      },
    },
  );

const take = async (Model, id) => {
  if (!id) return null;
  const before = await Model.findOneAndUpdate(
    { _id: id, "signOutReminder.pending": true },
    { $set: { "signOutReminder.pending": false } },
    { projection: { signOutReminder: 1 } },
  ).lean();
  if (!before) return null;

  const missedSignInAt = before.signOutReminder?.missedSignInAt || null;
  const day = missedSignInAt
    ? new Date(missedSignInAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "your last visit";
  return {
    missedSignInAt,
    message: `You did not sign out on ${day}. Please remember to sign out when you leave.`,
  };
};

const queueStaffReminder = (staffId, missedSignInAt) =>
  queue(StaffProfile, staffId, missedSignInAt);

const queueExternalReminder = (externalPersonId, missedSignInAt) =>
  queue(ExternalPerson, externalPersonId, missedSignInAt);

const takeStaffReminder = (staffId) => take(StaffProfile, staffId);

const takeExternalReminder = (externalPersonId) =>
  take(ExternalPerson, externalPersonId);

module.exports = {
  queueStaffReminder,
  queueExternalReminder,
  takeStaffReminder,
  takeExternalReminder,
};
