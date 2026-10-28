const { FamilyVisit } = require("@models/FamilyVisit");
const { Branch } = require("@models/Branch");
const { NotificationExp } = require("@models/Notifications");
const { FamilyVisitStatus, FamilyVisitSource } = require("@models/domainEnums");
const { toObjectId } = require("@appServices/family/familyPipeline");
const {
  cancelInvitations,
} = require("@appServices/family/familyVisitInvitation");
const { recipientsOf } = require("./familyGazetteNotifications");

const NOTIFY_CHUNK = 1000;
const OPEN = [
  FamilyVisitStatus.REQUESTED,
  FamilyVisitStatus.CONFIRMED,
  FamilyVisitStatus.INVITED,
];

const unique = (ids) => [...new Map(ids.map((id) => [String(id), id])).values()];

const tellFamilies = async ({ branchId, actorId, reason, receivers }) => {
  try {
    const [branch] = await Branch.aggregate([
      { $match: { _id: toObjectId(branchId) } },
      { $project: { name: 1 } },
    ]);
    const home = branch?.name || "your home";
    const body = `${reason ? `${reason}. ` : ""}Your booked visit at ${home} has been cancelled. We will let you know when visiting restarts.`;
    for (let i = 0; i < receivers.length; i += NOTIFY_CHUNK) {
      await NotificationExp.insertMany(
        receivers.slice(i, i + NOTIFY_CHUNK).map((receiverId) => ({
          type: "familyVisit",
          subjectId: actorId,
          objectId: toObjectId(branchId),
          objectType: "branch",
          receiverId,
          title: "Visiting is paused",
          body,
        })),
        { ordered: false },
      );
    }
  } catch (error) {
    console.error("family visit notification failed", error.message);
  }
};

/**
 * Pausing visiting cancels every visit still to come at the site, withdraws the kiosk codes issued for them and
 * tells the families affected. A notification that cannot be saved never undoes the pause.
 */
const cancelUpcomingVisits = async ({
  organizationId,
  branchId,
  actorId,
  reason = "",
  now = new Date(),
}) => {
  const visits = await FamilyVisit.find({
    organizationId: toObjectId(organizationId),
    branchId: toObjectId(branchId),
    status: { $in: OPEN },
    endAt: { $gt: now },
  })
    .select("source requestedBy residentId invitationId replies")
    .lean();
  if (!visits.length) return { cancelled: 0 };

  const done = await FamilyVisit.updateMany(
    { _id: { $in: visits.map((visit) => visit._id) }, status: { $in: OPEN } },
    {
      $set: {
        status: FamilyVisitStatus.CANCELLED,
        decidedBy: actorId,
        decidedAt: now,
        decisionNote: reason || "Visiting paused",
      },
    },
  );

  await cancelInvitations({
    invitationIds: visits
      .flatMap((visit) => [
        visit.invitationId,
        ...visit.replies.map((reply) => reply.invitationId),
      ])
      .filter(Boolean),
    userId: actorId,
    now,
  });

  const requesters = visits
    .filter((visit) => visit.source === FamilyVisitSource.FAMILY)
    .map((visit) => visit.requestedBy);
  const invitedResidents = visits
    .filter((visit) => visit.source === FamilyVisitSource.HOME)
    .map((visit) => visit.residentId);
  const invitedFamilies = invitedResidents.length
    ? await recipientsOf({
        organizationId: toObjectId(organizationId),
        residentId: { $in: unique(invitedResidents).map(toObjectId) },
      })
    : [];
  await tellFamilies({
    branchId,
    actorId,
    reason,
    receivers: unique([...requesters, ...invitedFamilies]),
  });

  return { cancelled: done.modifiedCount ?? visits.length };
};

module.exports = { cancelUpcomingVisits };
