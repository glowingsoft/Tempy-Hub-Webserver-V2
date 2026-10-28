const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { NotificationExp } = require("@models/Notifications");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { toObjectId } = require("@appServices/family/familyPipeline");

const NOTIFY_CHUNK = 1000;

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

/** Everyone actively linked to a resident, or to anyone at a site, each person once. */
const recipientsOf = async (match) => {
  const rows = await FamilyMember.aggregate([
    { $match: { ...match, status: FamilyMemberStatus.ACTIVE } },
    { $group: { _id: "$userId" } },
  ]);
  return rows.map((row) => row._id);
};

const deliver = async ({ receivers, build }) => {
  for (let i = 0; i < receivers.length; i += NOTIFY_CHUNK) {
    await NotificationExp.insertMany(
      receivers.slice(i, i + NOTIFY_CHUNK).map((receiverId) => ({ ...build(receiverId), receiverId })),
      { ordered: false }
    );
  }
  return receivers.length;
};

/**
 * A gazette is published to the family app when the home marks it printed, so that is when the family of the
 * resident hears about it. Called only for the gazette that was actually moved to printed, so each family is
 * told once. A notification that cannot be saved never undoes the printing.
 */
const notifyPrinted = async ({ item, actorId = null }) => {
  try {
    const [issue] = await FamilyGazetteIssue.aggregate([{ $match: { _id: item.issueId } }, { $project: { number: 1 } }]);
    const [resident] = await Resident.aggregate([{ $match: { _id: item.residentId } }, { $project: { name: 1 } }]);
    const [branch] = await Branch.aggregate([{ $match: { _id: item.branchId } }, { $project: { name: 1 } }]);

    const receivers = await recipientsOf({ organizationId: toObjectId(item.organizationId), residentId: toObjectId(item.residentId) });
    const who = firstName(resident?.name);
    return await deliver({
      receivers,
      build: () => ({
        type: "familyGazette",
        subjectId: actorId,
        objectId: item._id,
        objectType: "familyGazette",
        title: issue ? `Gazette no. ${issue.number} is ready` : "Your gazette is ready",
        body: `${who ? `${who}'s` : "The"} gazette from ${branch?.name || "the home"} has been printed. You can read it in the app.`,
      }),
    });
  } catch (error) {
    console.error("family gazette notification failed", error.message);
    return 0;
  }
};

/** "Gazette closes on 28 Oct": everyone linked to a resident at the site is asked for a photo or message. */
const notifyClosingSoon = async ({ receivers, closesAt, timezone, issueKey }) => {
  const when = moment.tz(closesAt, timezone).format("D MMM");
  return deliver({
    receivers,
    build: () => ({
      type: "familyGazetteReminder",
      subjectId: null,
      objectId: issueKey,
      objectType: "familyGazetteIssue",
      title: `The gazette closes on ${when}`,
      body: "Send a photo or message in the app before it closes to be in the next gazette.",
    }),
  });
};

module.exports = { notifyPrinted, notifyClosingSoon, recipientsOf };
