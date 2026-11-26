const { KioskActivity } = require("@models/KioskActivity");
const { User } = require("@models/UserModel");
const { ExternalPerson } = require("@models/ExternalPerson");

const nameOf = async ({ name, userId, externalPersonId }) => {
  if (name) return name;
  if (userId) {
    const user = await User.findById(userId).select("name").lean();
    return user?.name || "";
  }
  if (externalPersonId) {
    const person = await ExternalPerson.findById(externalPersonId).select("name").lean();
    return person?.name || "";
  }
  return "";
};

const recordKioskActivity = async ({ kioskId, branchId, type, ...who }) => {
  if (!kioskId || !branchId) return;
  try {
    await KioskActivity.create({
      kioskId,
      branchId,
      type,
      name: await nameOf(who),
      occurredAt: new Date(),
    });
  } catch (error) {
    console.error("kiosk activity not recorded", error.message);
  }
};

module.exports = { recordKioskActivity };
