const crypto = require("crypto");
const {
  VisitorAccountInvitation,
  RESIDENT_ACCOUNT_TYPE,
} = require("@models/VisitorAccountInvitation");
const { VisitorAccountInvitationStatus } = require("@models/domainEnums");

const INVITE_TTL_DAYS = Number(
  process.env.VISITOR_ACCOUNT_INVITE_TTL_DAYS || 7,
);

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const issueToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    lastSentAt: new Date(),
  };
};

const revokeResidentInvitations = ({ residentId, actorId }) =>
  VisitorAccountInvitation.updateMany(
    {
      residentId,
      personType: RESIDENT_ACCOUNT_TYPE,
      status: VisitorAccountInvitationStatus.PENDING,
    },
    {
      $set: {
        status: VisitorAccountInvitationStatus.REVOKED,
        revokedAt: new Date(),
        revokedByUserId: actorId,
      },
    },
  );

module.exports = {
  INVITE_TTL_DAYS,
  hashToken,
  issueToken,
  revokeResidentInvitations,
};
