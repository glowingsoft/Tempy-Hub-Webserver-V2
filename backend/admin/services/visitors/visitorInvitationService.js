const crypto = require("crypto");
const { Invitation } = require("@models/Invitation");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { paginateWithFacet } = require("@utils/paginate");
const { sendTransactionalEmail } = require("@utils/mailer");
const { visitorInvitationEmailTemplate } = require("@utils/emailTemplates");
const { AppError } = require("@services/_errors/AppError");
const { InvitationStatus, BadgeType } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./visitorAccess");

const INVITE_CODE_LENGTH = 6;
const OPEN_INVITE_STATUSES = [
  InvitationStatus.PENDING,
  InvitationStatus.AWAITING_GUEST,
  InvitationStatus.ACCEPTED,
];

const randomInviteCode = () => {
  const max = 10 ** INVITE_CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(INVITE_CODE_LENGTH, "0");
};

const uniqueInviteCode = async () => {
  let inviteCode = randomInviteCode();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const taken = await Invitation.exists({ inviteCode });
    if (!taken) return inviteCode;
    inviteCode = randomInviteCode();
  }
  return inviteCode;
};

const rotateInviteCode = async (invitation) => {
  invitation.inviteCode = await uniqueInviteCode();
  await invitation.save();
  return invitation;
};

const normalizeCode = (code) => String(code || "").trim();

const loadOrgName = async (organizationId, fallback) => {
  if (fallback) return fallback;
  const org = await Organization.findById(organizationId).select("name").lean();
  return org?.name || "";
};

const findOpenInvite = async ({ branchId, inviteCode }) => {
  const code = normalizeCode(inviteCode);
  if (!code) throw new AppError("invite_code_required", 400);

  return Invitation.findOne({
    branchId,
    inviteCode: code,
    status: { $in: OPEN_INVITE_STATUSES },
  });
};

const dispatchVisitorInvite = async ({ invitation, branch, organizationName }) => {
  await sendTransactionalEmail({
    to: invitation.visitorEmail,
    subject: `Your visit code for ${organizationName}`,
    html: visitorInvitationEmailTemplate({
      visitorName: invitation.visitorName,
      organizationName,
      branchName: branch?.name || "",
      inviteCode: invitation.inviteCode,
    }),
    previewUrl: invitation.inviteCode,
  });
};

const createVisitorInvitation = async ({
  actor,
  organizationId,
  organizationName,
  branchId,
  visitorName,
  visitorEmail,
  hostStaffId,
  arrivalAt,
  visitingUntil,
  badgeType,
  instructions,
}) => {
  if (!branchId) throw new AppError("branch_required", 400);
  if (!visitorName || !String(visitorName).trim()) {
    throw new AppError("name_required", 400);
  }
  if (!visitorEmail || !String(visitorEmail).trim()) {
    throw new AppError("email_required", 400);
  }
  if (!arrivalAt || !visitingUntil) {
    throw new AppError("visit_window_required", 400);
  }

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, branchId);
  await assertBranchInOrganization(branchId, organizationId);

  const branch = await Branch.findById(branchId).select("name").lean();
  if (!branch) throw new AppError("branch_not_found", 404);

  let inviteCode = await uniqueInviteCode();

  const invitation = await Invitation.create({
    organizationId,
    branchId,
    visitorName: String(visitorName).trim(),
    visitorEmail: String(visitorEmail).trim().toLowerCase(),
    hostStaffId: hostStaffId || null,
    badgeType: badgeType && Object.values(BadgeType).includes(badgeType)
      ? badgeType
      : BadgeType.GUEST,
    arrivalAt: new Date(arrivalAt),
    visitingUntil: new Date(visitingUntil),
    instructions: instructions || "",
    inviteCode,
    status: InvitationStatus.PENDING,
    createdBy: actor._id,
  });

  await dispatchVisitorInvite({
    invitation,
    branch,
    organizationName: await loadOrgName(organizationId, organizationName),
  });

  return invitation.toObject();
};

const listVisitorInvitations = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  status,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
  }

  const match = { organizationId };
  if (scopedBranchId) match.branchId = scopedBranchId;
  if (status) match.status = status;

  return paginateWithFacet({
    model: Invitation,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
  });
};

const resendVisitorInvitation = async ({
  actor,
  organizationId,
  organizationName,
  invitationId,
}) => {
  const invitation = await Invitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (!OPEN_INVITE_STATUSES.includes(invitation.status)) {
    throw new AppError("invitation_not_pending", 400);
  }

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, invitation.branchId);

  await rotateInviteCode(invitation);

  const branch = await Branch.findById(invitation.branchId).select("name").lean();
  await dispatchVisitorInvite({
    invitation,
    branch,
    organizationName: await loadOrgName(organizationId, organizationName),
  });

  return invitation.toObject();
};

const resendVisitorInvitationByEmail = async ({
  organizationId,
  branchId,
  email,
}) => {
  const normalised = String(email || "").trim().toLowerCase();
  if (!normalised) throw new AppError("email_required", 400);

  const invitation = await Invitation.findOne({
    organizationId,
    branchId,
    visitorEmail: normalised,
    status: { $in: OPEN_INVITE_STATUSES },
  }).sort({ createdAt: -1 });

  if (!invitation) throw new AppError("invitation_not_found", 404);

  await rotateInviteCode(invitation);

  const branch = await Branch.findById(invitation.branchId).select("name").lean();
  await dispatchVisitorInvite({
    invitation,
    branch,
    organizationName: await loadOrgName(organizationId),
  });

  return { email: invitation.visitorEmail, inviteCode: invitation.inviteCode };
};

const getOpenInvitationByCode = async ({ branchId, inviteCode }) => {
  const invitation = await findOpenInvite({ branchId, inviteCode });
  if (!invitation) throw new AppError("invite_code_invalid", 400);

  if (invitation.visitingUntil && invitation.visitingUntil.getTime() < Date.now()) {
    invitation.status = InvitationStatus.EXPIRED;
    await invitation.save();
    throw new AppError("invitation_expired", 400);
  }

  return invitation;
};

const markInvitationCheckedIn = async ({ invitation, visitSessionId }) => {
  invitation.status = InvitationStatus.CHECKED_IN;
  invitation.visitSessionId = visitSessionId;
  invitation.guestResponseAt = invitation.guestResponseAt || new Date();
  await invitation.save();
};

module.exports = {
  OPEN_INVITE_STATUSES,
  createVisitorInvitation,
  listVisitorInvitations,
  resendVisitorInvitation,
  getOpenInvitationByCode,
  markInvitationCheckedIn,
  resendVisitorInvitationByEmail,
  normalizeCode,
};
