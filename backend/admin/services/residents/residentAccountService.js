const mongoose = require("mongoose");
const validator = require("validator");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyInvitation } = require("@models/FamilyInvitation");
const {
  VisitorAccountInvitation,
  RESIDENT_ACCOUNT_TYPE,
} = require("@models/VisitorAccountInvitation");
const {
  AdmissionStatus,
  FamilyInvitationStatus,
  FamilyMemberStatus,
  VisitorAccountInvitationStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { frontendLink } = require("@utils/frontendUrl");
const { sendTransactionalEmail } = require("@utils/mailer");
const {
  visitorAccountInvitationEmailTemplate,
} = require("@utils/emailTemplates");
const { isStaffAccount } = require("@appServices/family/familyAccessService");
const {
  INVITE_TTL_DAYS,
  issueToken,
  revokeResidentInvitations,
} = require("@adminServices/visitors/accountInvitationToken");
const {
  createResident,
  getManagerResident,
  parseAdmissionStatus,
} = require("./residentService");
const { actorStanding, assertMayAccessResidents } = require("./residentAccess");

const AccountStatus = {
  NONE: "none",
  INVITED: "invited",
  ACTIVE: "active",
};

const buildAcceptUrl = (token) => {
  const override = process.env.RESIDENT_ACCOUNT_INVITE_ACCEPT_URL
    ? "RESIDENT_ACCOUNT_INVITE_ACCEPT_URL"
    : "VISITOR_ACCOUNT_INVITE_ACCEPT_URL";
  return `${frontendLink(override, "/visitor-account-invite")}/${token}`;
};

const normaliseEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const accountState = ({
  status,
  email = "",
  invitedAt = null,
  expiresAt = null,
}) => ({ status, email, invitedAt, expiresAt });

const getAccountState = async (residentId) => {
  const resident = await Resident.findById(residentId)
    .select("userId email admissionStatus")
    .lean();
  const admitted = resident?.admissionStatus === AdmissionStatus.ADMITTED;

  if (admitted && resident.userId) {
    const user = await User.findById(resident.userId).select("email").lean();
    return accountState({
      status: AccountStatus.ACTIVE,
      email: user?.email || "",
    });
  }

  const invitation = admitted
    ? await VisitorAccountInvitation.findOne({
        residentId,
        personType: RESIDENT_ACCOUNT_TYPE,
        status: VisitorAccountInvitationStatus.PENDING,
        expiresAt: { $gt: new Date() },
      })
        .select("email lastSentAt expiresAt")
        .lean()
    : null;

  if (invitation) {
    return accountState({
      status: AccountStatus.INVITED,
      email: invitation.email,
      invitedAt: invitation.lastSentAt,
      expiresAt: invitation.expiresAt,
    });
  }

  return accountState({
    status: AccountStatus.NONE,
    email: resident?.email || "",
  });
};

const assertEmailUsable = async ({ email, residentId }) => {
  const user = await User.findOne({ email })
    .select("_id accountState.userType")
    .lean();
  if (user && (await isStaffAccount(user))) {
    throw new AppError("email_used_by_staff", 409);
  }

  const [familyInvitation, familyMember, otherResident] = await Promise.all([
    FamilyInvitation.exists({
      residentId,
      email,
      status: FamilyInvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    }),
    user
      ? FamilyMember.exists({
          residentId,
          userId: user._id,
          status: {
            $in: [FamilyMemberStatus.ACTIVE, FamilyMemberStatus.PENDING],
          },
        })
      : null,
    user
      ? Resident.exists({
          _id: { $ne: residentId },
          userId: user._id,
          admissionStatus: AdmissionStatus.ADMITTED,
        })
      : null,
  ]);
  if (familyInvitation || familyMember) {
    throw new AppError("email_used_by_family_member", 409);
  }
  if (otherResident) {
    throw new AppError("email_used_by_another_resident", 409);
  }

  return user;
};

const saveInvitation = async ({
  actorId,
  organizationId,
  resident,
  email,
  pending,
}) => {
  const { token, ...tokenFields } = issueToken();
  const invitation =
    pending ||
    new VisitorAccountInvitation({
      organizationId,
      residentId: resident._id,
      personType: RESIDENT_ACCOUNT_TYPE,
    });
  invitation.set({
    ...tokenFields,
    branchId: resident.branchId,
    email,
    name: resident.name,
    invitedByUserId: actorId,
  });
  try {
    await invitation.save();
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("invitation_already_pending", 409);
    }
    throw error;
  }
  return { invitation, token };
};

const deliverInvitation = async ({ invitation, token }) => {
  const [organization, branch] = await Promise.all([
    Organization.findById(invitation.organizationId).select("name").lean(),
    Branch.findById(invitation.branchId).select("name").lean(),
  ]);
  const acceptUrl = buildAcceptUrl(token);
  await sendTransactionalEmail({
    to: invitation.email,
    subject: `Set your password for ${organization?.name || ""}`,
    html: visitorAccountInvitationEmailTemplate({
      name: invitation.name,
      organizationName: organization?.name || "",
      branchName: branch?.name || "",
      personType: RESIDENT_ACCOUNT_TYPE,
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
    previewUrl: acceptUrl,
  });
  return acceptUrl;
};

const assertCanInviteNewResident = async ({
  actor,
  organizationId,
  branchId,
  email,
  admissionStatus,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayAccessResidents(standing, branchId);

  const status =
    parseAdmissionStatus(admissionStatus) || AdmissionStatus.ADMITTED;
  if (status !== AdmissionStatus.ADMITTED) {
    throw new AppError("resident_not_admitted", 409);
  }

  const address = normaliseEmail(email);
  if (!validator.isEmail(address)) throw new AppError("email_invalid", 400);
  await assertEmailUsable({
    email: address,
    residentId: new mongoose.Types.ObjectId(),
  });
  if (
    await VisitorAccountInvitation.exists({
      organizationId,
      branchId,
      email: address,
      status: VisitorAccountInvitationStatus.PENDING,
    })
  ) {
    throw new AppError("invitation_already_pending", 409);
  }

  return address;
};

const addResident = async (fields) => {
  const email = await assertCanInviteNewResident(fields);
  const resident = await createResident({ ...fields, email });

  let saved;
  try {
    saved = await saveInvitation({
      actorId: fields.actor._id,
      organizationId: fields.organizationId,
      resident,
      email,
    });
  } catch (error) {
    await Resident.deleteOne({ _id: resident._id });
    throw error;
  }
  const acceptUrl = await deliverInvitation(saved);

  return {
    ...resident,
    account: await getAccountState(resident._id),
    acceptUrl,
  };
};

const sendAccountInvitation = async ({
  actor,
  organizationId,
  residentId,
  email,
}) => {
  await getManagerResident({ actor, organizationId, residentId });
  const resident = await Resident.findById(residentId)
    .select("name email branchId admissionStatus userId")
    .lean();
  if (resident.admissionStatus !== AdmissionStatus.ADMITTED) {
    throw new AppError("resident_not_admitted", 409);
  }
  if (resident.userId) {
    throw new AppError("resident_account_already_linked", 409);
  }

  const pending = await VisitorAccountInvitation.findOne({
    residentId: resident._id,
    personType: RESIDENT_ACCOUNT_TYPE,
    status: VisitorAccountInvitationStatus.PENDING,
  });
  const address = normaliseEmail(email || pending?.email || resident.email);
  if (!validator.isEmail(address)) throw new AppError("email_invalid", 400);
  await assertEmailUsable({ email: address, residentId: resident._id });

  const saved = await saveInvitation({
    actorId: actor._id,
    organizationId,
    resident,
    email: address,
    pending,
  });
  const acceptUrl = await deliverInvitation(saved);

  return { account: await getAccountState(resident._id), acceptUrl };
};

const removeAccount = async ({ actor, organizationId, residentId }) => {
  const resident = await getManagerResident({
    actor,
    organizationId,
    residentId,
  });
  const [revoked, unlinked] = await Promise.all([
    revokeResidentInvitations({ residentId: resident._id, actorId: actor._id }),
    Resident.updateOne(
      { _id: resident._id, userId: { $ne: null } },
      { $set: { userId: null } },
    ),
  ]);
  if (!revoked.modifiedCount && !unlinked.modifiedCount) {
    throw new AppError("resident_account_not_found", 404);
  }

  return { account: await getAccountState(resident._id) };
};

const acceptResidentInvitation = async ({
  invitation,
  name,
  password,
  timezone,
}) => {
  const resident = await Resident.findOne({
    _id: invitation.residentId,
    organizationId: invitation.organizationId,
  })
    .select("userId admissionStatus branchId")
    .lean();
  if (!resident) throw new AppError("resident_not_found", 404);
  if (resident.admissionStatus !== AdmissionStatus.ADMITTED) {
    throw new AppError("resident_not_admitted", 409);
  }

  const existing = await assertEmailUsable({
    email: invitation.email,
    residentId: resident._id,
  });
  if (resident.userId && String(resident.userId) !== String(existing?._id)) {
    throw new AppError("resident_account_already_linked", 409);
  }
  if (!existing && !password) throw new AppError("password_required", 400);

  let resolvedTimezone = timezone;
  if (!existing && !resolvedTimezone) {
    const branch = await Branch.findById(resident.branchId)
      .select("timezone")
      .lean();
    resolvedTimezone = branch?.timezone || "Europe/London";
  }

  const dbSession = await mongoose.startSession();
  try {
    let userId;
    await dbSession.withTransaction(async () => {
      userId = existing?._id;
      if (!userId) {
        const [created] = await User.create(
          [
            {
              name: name || invitation.name || invitation.email,
              email: invitation.email,
              password,
              timezone: resolvedTimezone,
              accountState: { userType: "user" },
              verificationStatus: { email: "verified" },
            },
          ],
          { session: dbSession },
        );
        userId = created._id;
      }

      await Resident.updateMany(
        {
          _id: { $ne: resident._id },
          userId,
          admissionStatus: AdmissionStatus.DISCHARGED,
        },
        { $set: { userId: null } },
        { session: dbSession },
      );

      const linked = await Resident.updateOne(
        {
          _id: resident._id,
          admissionStatus: AdmissionStatus.ADMITTED,
          userId: { $in: [null, userId] },
        },
        { $set: { userId } },
        { session: dbSession },
      );
      if (!linked.matchedCount) {
        throw new AppError("resident_account_already_linked", 409);
      }

      const accepted = await VisitorAccountInvitation.updateOne(
        {
          _id: invitation._id,
          tokenHash: invitation.tokenHash,
          status: VisitorAccountInvitationStatus.PENDING,
        },
        {
          $set: {
            status: VisitorAccountInvitationStatus.ACCEPTED,
            acceptedAt: new Date(),
            acceptedByUserId: userId,
          },
        },
        { session: dbSession },
      );
      if (!accepted.modifiedCount) {
        throw new AppError("invitation_not_pending", 400);
      }
    });

    return {
      userId,
      email: invitation.email,
      residentId: resident._id,
      personType: RESIDENT_ACCOUNT_TYPE,
    };
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("resident_account_already_linked", 409);
    }
    throw error;
  } finally {
    await dbSession.endSession();
  }
};

module.exports = {
  addResident,
  getAccountState,
  sendAccountInvitation,
  removeAccount,
  acceptResidentInvitation,
};
