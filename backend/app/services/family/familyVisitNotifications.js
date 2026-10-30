const moment = require("moment-timezone");
const { NotificationTypes } = require("@models/Notifications");
const { FamilyVisit } = require("@models/FamilyVisit");
const { FamilyVisitReply, FamilyVisitSource } = require("@models/domainEnums");
const { toObjectId } = require("./familyPipeline");
const { managersOf, familyOf, namesOf, notify, quietly } = require("./familyNotify");

const TIME = "HH:mm";

const detailsOf = async (visit) => {
  const { resident, home, timezone } = await namesOf(visit);
  const start = moment.tz(visit.startAt, timezone);
  const end = moment.tz(visit.endAt, timezone);
  return {
    resident,
    home,
    place: visit.place,
    when: `${start.format("ddd D MMM")}, ${start.format(TIME)} - ${end.format(TIME)}`,
  };
};

const about = (visit) => ({
  type: NotificationTypes.FAMILY_VISIT,
  objectId: visit._id,
  objectType: "familyVisit",
});

const notifyVisitRequested = ({ visit, requesterName }) =>
  quietly(async () => {
    const { resident, when, place } = await detailsOf(visit);
    const people = visit.partySize === 1 ? "1 person" : `${visit.partySize} people`;
    await notify({
      ...about(visit),
      receivers: await managersOf(visit),
      subjectId: visit.requestedBy,
      title: "New visit request",
      body: `${requesterName} asked to visit ${resident} on ${when} (${people}, ${place}).`,
    });
  });

const notifyVisitInvited = ({ visit }) =>
  quietly(async () => {
    const { resident, home, when, place } = await detailsOf(visit);
    await notify({
      ...about(visit),
      receivers: await familyOf(visit),
      subjectId: visit.invitedBy,
      title: "Visit invitation",
      body: `${home} invited you to visit ${resident} on ${when} in ${place}.`,
    });
  });

/** The home answered a request, or cancelled a visit; decision is confirm, decline or cancel. */
const notifyVisitDecision = ({ visit, decision, actorId }) =>
  quietly(async () => {
    const { resident, home, when } = await detailsOf(visit);
    const note = visit.decisionNote ? ` ${visit.decisionNote}` : "";
    const message = {
      confirm: [
        "Visit confirmed",
        `Your visit to ${resident} at ${home} on ${when} is confirmed. Your Visit Pass is ready.`,
      ],
      decline: [
        "Visit declined",
        `${home} couldn't confirm your visit to ${resident} on ${when}.${note}`,
      ],
      cancel: [
        "Visit cancelled",
        `${home} cancelled the visit to ${resident} on ${when}.${note}`,
      ],
    }[decision];
    if (!message) return;

    const receivers =
      visit.source === FamilyVisitSource.FAMILY
        ? [visit.requestedBy]
        : await familyOf(visit);
    await notify({
      ...about(visit),
      receivers,
      subjectId: actorId,
      title: message[0],
      body: message[1],
    });
  });

const notifyVisitReply = ({ visitId, user, response }) =>
  quietly(async () => {
    const [visit] = await FamilyVisit.aggregate([
      { $match: { _id: toObjectId(visitId) } },
      {
        $project: {
          organizationId: 1,
          branchId: 1,
          residentId: 1,
          startAt: 1,
          endAt: 1,
          place: 1,
        },
      },
    ]);
    if (!visit) return;

    const { resident, when } = await detailsOf(visit);
    const going = response === FamilyVisitReply.GOING;
    await notify({
      ...about(visit),
      receivers: await managersOf(visit),
      subjectId: user._id,
      title: going ? "Invitation accepted" : "Can't make the visit",
      body: going
        ? `${user.name} will be there for the visit to ${resident} on ${when}.`
        : `${user.name} can't make the visit to ${resident} on ${when}.`,
    });
  });

const notifyVisitCancelledByFamily = ({ visit, user }) =>
  quietly(async () => {
    const { resident, when } = await detailsOf(visit);
    await notify({
      ...about(visit),
      receivers: await managersOf(visit),
      subjectId: user._id,
      title: "Visit cancelled by family",
      body: `${user.name} cancelled their visit to ${resident} on ${when}.`,
    });
  });

module.exports = {
  notifyVisitRequested,
  notifyVisitInvited,
  notifyVisitDecision,
  notifyVisitReply,
  notifyVisitCancelledByFamily,
};
