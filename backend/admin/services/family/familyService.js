const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { Resident } = require("@models/Resident");
const { FamilyInvitation } = require("@models/FamilyInvitation");
const { FamilyMember } = require("@models/FamilyMember");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { sendTransactionalEmail } = require("@utils/mailer");
const { familyInvitationEmailTemplate } = require("@utils/emailTemplates");
const { AppError } = require("@services/_errors/AppError");
const {
  FamilyInvitationStatus,
  FamilyJoinSource,
  FamilyMemberStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayAccessResidents,
} = require("@adminServices/residents/residentAccess");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const INVITE_TTL_DAYS = Number(process.env.FAMILY_INVITE_TTL_DAYS || 7);

const buildAcceptUrl = (token) => {
  const base = (
    process.env.FAMILY_INVITE_ACCEPT_URL || "http://localhost:3000/family-invite"
  ).replace(/\/+$/, "");
  return `${base}/${token}`;
};

const stripHash = (invitation) => {
  const { tokenHash, ...safe } =
    typeof invitation.toObject === "function"
      ? invitation.toObject()
      : invitation;
  return safe;
};

// owner/superAdmin anywhere in the org; site and line managers on their own site
const requireManageableResident = async ({
  actor,
  organizationId,
  residentId,
}) => {
  const resident = await Resident.findOne({
    _id: residentId,
    organizationId,
  })
    .select("name branchId organizationId")
    .lean();
  if (!resident) throw new AppError("resident_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayAccessResidents(standing, resident.branchId);

  return resident;
};

const dispatchInvitation = async ({
  invitation,
  token,
  organization,
  branch,
  resident,
}) => {
  const acceptUrl = buildAcceptUrl(token);

  await sendTransactionalEmail({
    to: invitation.email,
    subject: `You have been invited to connect with ${resident.name}`,
    html: familyInvitationEmailTemplate({
      inviteeName: invitation.name,
      residentName: resident.name,
      organizationName: organization.name,
      branchName: branch?.name || "",
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
    previewUrl: acceptUrl,
  });

  return acceptUrl;
};

const inviteFamilyMember = async ({
  actor,
  organizationId,
  residentId,
  email,
  name,
  phone,
  relationship,
  isNextOfKin = false,
}) => {
  const organization = await Organization.findById(organizationId)
    .select("name")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);

  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId,
  });

  const normalisedEmail = String(email).trim().toLowerCase();
  if (!validator.isEmail(normalisedEmail)) {
    throw new AppError("email_invalid", 400);
  }

  const existingUser = await User.findOne({ email: normalisedEmail })
    .select("_id")
    .lean();
  if (existingUser) {
    const alreadyLinked = await FamilyMember.exists({
      userId: existingUser._id,
      residentId,
      status: FamilyMemberStatus.ACTIVE,
    });
    if (alreadyLinked) throw new AppError("family_member_already_exists", 409);
  }

  if (
    await FamilyInvitation.exists({
      residentId,
      email: normalisedEmail,
      status: FamilyInvitationStatus.PENDING,
    })
  ) {
    throw new AppError("invitation_already_pending", 409);
  }

  const token = crypto.randomBytes(32).toString("hex");

  let invitation;
  try {
    invitation = await FamilyInvitation.create({
      organizationId,
      branchId: resident.branchId,
      residentId,
      email: normalisedEmail,
      name: name || "",
      phone: phone || "",
      relationship,
      isNextOfKin: Boolean(isNextOfKin),
      tokenHash: await bcrypt.hash(token, 10),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      invitedByUserId: actor._id,
      lastSentAt: new Date(),
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("invitation_already_pending", 409);
    throw error;
  }

  const branch = await Branch.findById(resident.branchId).select("name").lean();

  const acceptUrl = await dispatchInvitation({
    invitation,
    token,
    organization,
    branch,
    resident,
  });

  return { ...stripHash(invitation), acceptUrl };
};

const listInvitations = async ({
  organizationId,
  page,
  limit,
  skip,
  status,
  residentId,
  keyword,
}) => {
  const match = { organizationId: toObjectId(organizationId) };
  if (status) match.status = status;
  if (residentId) match.residentId = toObjectId(residentId);

  const or = keywordOr(keyword, ["email", "name"], { trim: true });
  if (or) match.$or = or;

  return paginateWithFacet({
    model: FamilyInvitation,
    match,
    page,
    limit,
    skip,
    extraDataStages: [{ $project: { tokenHash: 0 } }],
  });
};

const getInvitation = async ({ invitationId, organizationId }) => {
  const invitation = await FamilyInvitation.findOne({
    _id: invitationId,
    organizationId,
  }).lean();
  if (!invitation) throw new AppError("invitation_not_found", 404);

  return stripHash(invitation);
};

// the old token is unrecoverable (only its hash was kept), so a resend issues a new one
const resendInvitation = async ({ actor, invitationId, organizationId }) => {
  const invitation = await FamilyInvitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (invitation.status !== FamilyInvitationStatus.PENDING) {
    throw new AppError("invitation_not_pending", 400);
  }

  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId: invitation.residentId,
  });

  const token = crypto.randomBytes(32).toString("hex");
  invitation.tokenHash = await bcrypt.hash(token, 10);
  invitation.expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  invitation.lastSentAt = new Date();
  invitation.sendCount += 1;
  await invitation.save();

  const [organization, branch] = await Promise.all([
    Organization.findById(organizationId).select("name").lean(),
    Branch.findById(invitation.branchId).select("name").lean(),
  ]);

  const acceptUrl = await dispatchInvitation({
    invitation,
    token,
    organization,
    branch,
    resident,
  });

  return { ...stripHash(invitation), acceptUrl };
};

const revokeInvitation = async ({ actor, invitationId, organizationId }) => {
  const invitation = await FamilyInvitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (invitation.status !== FamilyInvitationStatus.PENDING) {
    throw new AppError("invitation_not_pending", 400);
  }

  await requireManageableResident({
    actor,
    organizationId,
    residentId: invitation.residentId,
  });

  invitation.status = FamilyInvitationStatus.REVOKED;
  invitation.revokedAt = new Date();
  invitation.revokedByUserId = actor._id;
  await invitation.save({ validateModifiedOnly: true });

  return stripHash(invitation);
};

// Only the hash is stored, so every pending row has to be compared (same trade-off as staff).
const findByToken = async (token) => {
  if (!token) throw new AppError("invitation_not_found", 404);

  const pending = await FamilyInvitation.find({
    status: FamilyInvitationStatus.PENDING,
  }).select("+tokenHash");

  for (const invitation of pending) {
    if (await bcrypt.compare(String(token), invitation.tokenHash)) {
      if (invitation.expiresAt.getTime() < Date.now()) {
        invitation.status = FamilyInvitationStatus.EXPIRED;
        await invitation.save();
        throw new AppError("invitation_expired", 400);
      }
      return invitation;
    }
  }

  throw new AppError("invitation_not_found", 404);
};

const shapeInvitationPreview = async (invitation) => {
  const [organization, branch, resident] = await Promise.all([
    Organization.findById(invitation.organizationId).select("name").lean(),
    Branch.findById(invitation.branchId).select("name").lean(),
    Resident.findById(invitation.residentId).select("name photoUrl").lean(),
  ]);

  return {
    invitationId: invitation._id,
    email: invitation.email,
    name: invitation.name,
    relationship: invitation.relationship,
    organizationId: invitation.organizationId,
    organizationName: organization?.name || "",
    branchId: invitation.branchId,
    branchName: branch?.name || "",
    residentId: invitation.residentId,
    residentName: resident?.name || "",
    residentPhotoUrl: resident?.photoUrl || "",
    expiresAt: invitation.expiresAt,
    requiresPassword: !(await User.exists({ email: invitation.email })),
  };
};

const previewInvitation = async (token) => {
  const invitation = await findByToken(token);
  return shapeInvitationPreview(invitation);
};

const listMyInvitations = async ({ user, page, limit, skip }) => {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) throw new AppError("email_required", 400);

  const { data, meta } = await paginateWithFacet({
    model: FamilyInvitation,
    match: {
      email,
      status: FamilyInvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    },
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: [{ $project: { tokenHash: 0 } }],
  });

  return {
    data: await Promise.all(data.map((row) => shapeInvitationPreview(row))),
    meta,
  };
};

const requireMyPendingInvitation = async ({ user, invitationId }) => {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) throw new AppError("email_required", 400);

  const invitation = await FamilyInvitation.findOne({
    _id: invitationId,
    email,
    status: FamilyInvitationStatus.PENDING,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);

  if (invitation.expiresAt.getTime() < Date.now()) {
    invitation.status = FamilyInvitationStatus.EXPIRED;
    await invitation.save({ validateModifiedOnly: true });
    throw new AppError("invitation_expired", 400);
  }

  return invitation;
};

const getMyInvitation = async ({ user, invitationId }) => {
  const invitation = await requireMyPendingInvitation({ user, invitationId });
  return shapeInvitationPreview(invitation);
};

/** An existing account keeps its password and only gains the link. */
const redeemInvitation = async ({
  invitation,
  existingUser = null,
  name,
  password,
  timezone,
}) => {
  if (!validator.isEmail(invitation.email)) {
    throw new AppError("email_invalid", 400);
  }

  let user =
    existingUser || (await User.findOne({ email: invitation.email }));

  if (!user && !password) throw new AppError("password_required", 400);

  let resolvedTimezone = timezone;
  if (!user && !resolvedTimezone) {
    const branch = await Branch.findById(invitation.branchId)
      .select("timezone")
      .lean();
    resolvedTimezone = branch?.timezone || "Europe/London";
  }

  const session = await mongoose.startSession();
  try {
    let familyMember;

    await session.withTransaction(async () => {
      if (!user) {
        const [created] = await User.create(
          [
            {
              name: name || invitation.name || invitation.email,
              email: invitation.email,
              password,
              timezone: resolvedTimezone,
              accountState: { userType: "user" },
              // The token was only ever emailed to this address, so redeeming
              // it proves control of the mailbox; no OTP round trip needed.
              verificationStatus: { email: "verified" },
            },
          ],
          { session }
        );
        user = created;
      }

      const existing = await FamilyMember.findOne({
        userId: user._id,
        residentId: invitation.residentId,
      }).session(session);

      if (existing?.status === FamilyMemberStatus.ACTIVE) {
        throw new AppError("family_member_already_exists", 409);
      }

      // One next of kin per resident, enforced by a unique index, so the
      // previous one has to step down before this one is saved.
      if (invitation.isNextOfKin) {
        await FamilyMember.updateMany(
          {
            residentId: invitation.residentId,
            userId: { $ne: user._id },
            isNextOfKin: true,
          },
          { $set: { isNextOfKin: false } },
          { session }
        );
      }

      const linkFields = {
        relationship: invitation.relationship,
        isNextOfKin: invitation.isNextOfKin,
        phone: invitation.phone,
        status: FamilyMemberStatus.ACTIVE,
        joinedVia: FamilyJoinSource.INVITATION,
        decidedBy: invitation.invitedByUserId,
        decidedAt: new Date(),
        removedBy: null,
        removedAt: null,
      };

      if (existing) {
        Object.assign(existing, linkFields);
        await existing.save({ session });
        familyMember = existing;
      } else {
        const [created] = await FamilyMember.create(
          [
            {
              userId: user._id,
              organizationId: invitation.organizationId,
              branchId: invitation.branchId,
              residentId: invitation.residentId,
              ...linkFields,
            },
          ],
          { session }
        );
        familyMember = created;
      }

      invitation.status = FamilyInvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
      invitation.acceptedByUserId = user._id;
      await invitation.save({ session });
    });

    return {
      familyMember: familyMember.toObject(),
      userId: user._id,
      email: user.email,
    };
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("family_member_already_exists", 409);
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const acceptInvitation = async ({ token, name, password, timezone }) => {
  const invitation = await findByToken(token);
  return redeemInvitation({ invitation, name, password, timezone });
};

const acceptMyInvitation = async ({ user, invitationId }) => {
  const invitation = await requireMyPendingInvitation({ user, invitationId });
  return redeemInvitation({ invitation, existingUser: user });
};

module.exports = {
  inviteFamilyMember,
  listInvitations,
  getInvitation,
  resendInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  listMyInvitations,
  getMyInvitation,
  acceptMyInvitation,
};
