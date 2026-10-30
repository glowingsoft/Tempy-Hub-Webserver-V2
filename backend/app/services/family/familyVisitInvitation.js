const crypto = require("crypto");
const { Invitation } = require("@models/Invitation");
const { InvitationStatus } = require("@models/domainEnums");

const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 8;
const OPEN = [
  InvitationStatus.PENDING,
  InvitationStatus.AWAITING_GUEST,
  InvitationStatus.ACCEPTED,
];

const randomCode = () =>
  String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");

const isDuplicateKey = (error) => error?.code === 11000;

/**
 * The ordinary invitation the kiosk already understands, so a confirmed family visit checks in at the
 * kiosk like any other. The unique index decides code clashes, so two requests cannot take the same code.
 */
const issueInvitation = async ({
  visit,
  visitorName,
  visitorEmail,
  residentName,
  createdBy,
}) => {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    try {
      return await Invitation.create({
        organizationId: visit.organizationId,
        branchId: visit.branchId,
        residentId: visit.residentId,
        visitorName,
        visitorEmail: String(visitorEmail || "").toLowerCase(),
        arrivalAt: visit.startAt,
        visitingUntil: visit.endAt,
        instructions: [`Visiting ${residentName}`, visit.place]
          .filter(Boolean)
          .join(" · "),
        inviteCode: randomCode(),
        status: InvitationStatus.ACCEPTED,
        createdBy,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new Error("Could not allocate an invitation code");
};

/** Withdraws an invitation that has not been used yet; one already checked in is left alone. */
const cancelInvitation = async ({ invitationId, userId, now = new Date() }) => {
  if (!invitationId) return;
  await Invitation.updateOne(
    { _id: invitationId, status: { $in: OPEN } },
    {
      $set: {
        status: InvitationStatus.CANCELLED,
        cancelledAt: now,
        cancelledBy: userId,
      },
    },
  );
};

/** Withdraws many invitations at once, leaving any already used. */
const cancelInvitations = async ({ invitationIds, userId, now = new Date() }) => {
  if (!invitationIds.length) return;
  await Invitation.updateMany(
    { _id: { $in: invitationIds }, status: { $in: OPEN } },
    {
      $set: {
        status: InvitationStatus.CANCELLED,
        cancelledAt: now,
        cancelledBy: userId,
      },
    },
  );
};

module.exports = {
  OPEN_INVITATION_STATUSES: OPEN,
  issueInvitation,
  cancelInvitation,
  cancelInvitations,
};
