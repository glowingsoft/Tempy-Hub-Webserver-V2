const crypto = require("crypto");
const mongoose = require("mongoose");
const validator = require("validator");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { ExternalPerson } = require("@models/ExternalPerson");
const { VisitorAccountInvitation } = require("@models/VisitorAccountInvitation");
const { sendTransactionalEmail } = require("@utils/mailer");
const { visitorAccountInvitationEmailTemplate } = require("@utils/emailTemplates");
const { AppError } = require("@services/_errors/AppError");
const {
  ExternalPersonType,
  VisitorAccountInvitationStatus,
} = require("@models/domainEnums");
const { isStaffAccount } = require("@appServices/family/familyAccessService");
const { paginateWithFacet, facetCount, keywordOr } = require("@utils/paginate");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./visitorAccess");
const { toObjectId } = require("./visitPresenceQuery");

const INVITE_TTL_DAYS = Number(process.env.VISITOR_ACCOUNT_INVITE_TTL_DAYS || 7);
const ACCOUNT_TYPES = [ExternalPersonType.VISITOR, ExternalPersonType.CONTRACTOR];

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const buildAcceptUrl = (token) => {
  const base = (
    process.env.VISITOR_ACCOUNT_INVITE_ACCEPT_URL ||
    "http://localhost:3000/visitor-account-invite"
  ).replace(/\/+$/, "");
  return `${base}/${token}`;
};

const stripHash = (invitation) => {
  const row = invitation.toObject ? invitation.toObject() : { ...invitation };
  delete row.tokenHash;
  return row;
};

const parseAccountType = (type) => {
  const value = String(type || "").trim();
  if (!ACCOUNT_TYPES.includes(value)) {
    throw new AppError("invalid_external_person_type", 400);
  }
  return value;
};

const findPersonByEmail = async ({ branchId, email, session }) => {
  const query = ExternalPerson.findOne({
    branchId,
    email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (session) query.session(session);
  return query;
};

const sendInviteEmail = async ({ invitation, token, organizationName, branchName }) => {
  const acceptUrl = buildAcceptUrl(token);
  await sendTransactionalEmail({
    to: invitation.email,
    subject: `Set your password for ${organizationName}`,
    html: visitorAccountInvitationEmailTemplate({
      name: invitation.name,
      organizationName,
      branchName,
      personType: invitation.personType,
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
    previewUrl: acceptUrl,
  });
  return acceptUrl;
};

const createVisitorAccountInvitation = async ({
  actor,
  organizationId,
  branchId,
  email,
  name,
  type,
}) => {
  if (!branchId) throw new AppError("branch_required", 400);
  const normalisedEmail = String(email || "").trim().toLowerCase();
  if (!validator.isEmail(normalisedEmail)) throw new AppError("email_invalid", 400);
  const personType = parseAccountType(type);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, branchId);
  await assertBranchInOrganization(branchId, organizationId);

  const [organization, branch] = await Promise.all([
    Organization.findById(organizationId).select("name").lean(),
    Branch.findById(branchId).select("name organizationId").lean(),
  ]);
  if (!organization) throw new AppError("organization_not_found", 404);
  if (!branch) throw new AppError("branch_not_found", 404);

  const existingUser = await User.findOne({ email: normalisedEmail })
    .select("_id accountState.userType")
    .lean();
  if (existingUser && (await isStaffAccount(existingUser))) {
    throw new AppError("email_used_by_staff", 409);
  }

  const person = await findPersonByEmail({ branchId, email: normalisedEmail });
  if (person?.userId) throw new AppError("visitor_account_already_linked", 409);

  if (
    await VisitorAccountInvitation.exists({
      branchId,
      email: normalisedEmail,
      status: VisitorAccountInvitationStatus.PENDING,
    })
  ) {
    throw new AppError("invitation_already_pending", 409);
  }

  const token = crypto.randomBytes(32).toString("hex");
  let invitation;
  try {
    invitation = await VisitorAccountInvitation.create({
      organizationId,
      branchId,
      email: normalisedEmail,
      name: name ? String(name).trim() : person?.name || "",
      personType: person?.type && ACCOUNT_TYPES.includes(person.type) ? person.type : personType,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      invitedByUserId: actor._id,
      externalPersonId: person?._id || null,
      lastSentAt: new Date(),
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError("invitation_already_pending", 409);
    throw error;
  }

  const acceptUrl = await sendInviteEmail({
    invitation,
    token,
    organizationName: organization.name || "",
    branchName: branch.name || "",
  });

  return { ...stripHash(invitation), acceptUrl };
};

const loadOrgAccountInvitation = async ({ invitationId, organizationId }) => {
  const invitation = await VisitorAccountInvitation.findOne({
    _id: invitationId,
    organizationId,
  }).select("+tokenHash");
  if (!invitation) throw new AppError("invitation_not_found", 404);
  return invitation;
};

const assertPendingAccountInvite = (invitation) => {
  if (invitation.status !== VisitorAccountInvitationStatus.PENDING) {
    throw new AppError("invitation_not_pending", 400);
  }
};

const resendVisitorAccountInvitation = async ({
  actor,
  organizationId,
  invitationId,
}) => {
  const invitation = await loadOrgAccountInvitation({
    invitationId,
    organizationId,
  });
  assertPendingAccountInvite(invitation);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, invitation.branchId);

  const token = crypto.randomBytes(32).toString("hex");
  invitation.tokenHash = hashToken(token);
  invitation.expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  invitation.lastSentAt = new Date();
  await invitation.save({ validateModifiedOnly: true });

  const [organization, branch] = await Promise.all([
    Organization.findById(organizationId).select("name").lean(),
    Branch.findById(invitation.branchId).select("name").lean(),
  ]);

  const acceptUrl = await sendInviteEmail({
    invitation,
    token,
    organizationName: organization?.name || "",
    branchName: branch?.name || "",
  });

  return { ...stripHash(invitation), acceptUrl };
};

const revokeVisitorAccountInvitation = async ({
  actor,
  organizationId,
  invitationId,
}) => {
  const invitation = await loadOrgAccountInvitation({
    invitationId,
    organizationId,
  });
  assertPendingAccountInvite(invitation);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, invitation.branchId);

  invitation.status = VisitorAccountInvitationStatus.REVOKED;
  invitation.revokedAt = new Date();
  invitation.revokedByUserId = actor._id;
  await invitation.save({ validateModifiedOnly: true });

  return stripHash(invitation);
};

const parseAccountInvitationStatus = (status) => {
  if (status == null || status === "") return null;
  const value = String(status).trim();
  if (!Object.values(VisitorAccountInvitationStatus).includes(value)) {
    throw new AppError("invalid_invitation_status", 400);
  }
  return value;
};

const accountInvitationStatusCountFacets = (countMatch) =>
  Object.fromEntries(
    Object.values(VisitorAccountInvitationStatus).map((status) => [
      `${status}Count`,
      [{ $match: { ...countMatch, status } }, { $count: "count" }],
    ])
  );

const emptyAccountInvitationStatusCounts = () =>
  Object.fromEntries(
    Object.values(VisitorAccountInvitationStatus).map((status) => [status, 0])
  );

const accountInvitationStatusCountsFromFacet = (result) => {
  const counts = emptyAccountInvitationStatusCounts();
  for (const status of Object.values(VisitorAccountInvitationStatus)) {
    counts[status] = facetCount(result[`${status}Count`]);
  }
  return counts;
};

const accountInviteDetailStages = [
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      pipeline: [{ $project: { _id: 1, name: 1, timezone: 1 } }],
      as: "branch",
    },
  },
  { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: ExternalPerson.collection.name,
      localField: "externalPersonId",
      foreignField: "_id",
      pipeline: [
        { $project: { _id: 1, name: 1, email: 1, type: 1, userId: 1 } },
      ],
      as: "person",
    },
  },
  { $unwind: { path: "$person", preserveNullAndEmptyArrays: true } },
  { $project: { tokenHash: 0 } },
];

const listVisitorAccountInvitations = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  status,
  type,
  keyword,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
  }

  const match = { organizationId: toObjectId(organizationId) };
  if (scopedBranchId) match.branchId = toObjectId(scopedBranchId);
  if (type) match.personType = parseAccountType(type);

  const keywordMatch = keywordOr(keyword, ["email", "name"], { trim: true });
  if (keywordMatch) match.$or = keywordMatch;

  const countMatch = { ...match };
  const invitationStatus = parseAccountInvitationStatus(status);
  if (invitationStatus) match.status = invitationStatus;

  const { data, meta, result } = await paginateWithFacet({
    model: VisitorAccountInvitation,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: accountInviteDetailStages,
    extraFacets: accountInvitationStatusCountFacets(countMatch),
  });

  return {
    data,
    meta: {
      ...meta,
      counts: result
        ? accountInvitationStatusCountsFromFacet(result)
        : emptyAccountInvitationStatusCounts(),
    },
  };
};

const loadPendingByToken = async (token) => {
  if (!token) throw new AppError("invitation_not_found", 404);
  const invitation = await VisitorAccountInvitation.findOne({
    tokenHash: hashToken(token),
    status: VisitorAccountInvitationStatus.PENDING,
  }).select("+tokenHash");
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (invitation.expiresAt.getTime() < Date.now()) {
    invitation.status = VisitorAccountInvitationStatus.EXPIRED;
    await invitation.save({ validateModifiedOnly: true });
    throw new AppError("invitation_expired", 400);
  }
  return invitation;
};

const previewVisitorAccountInvitation = async ({ token }) => {
  const invitation = await loadPendingByToken(token);
  const [organization, branch] = await Promise.all([
    Organization.findById(invitation.organizationId).select("name").lean(),
    Branch.findById(invitation.branchId).select("name").lean(),
  ]);
  return {
    email: invitation.email,
    name: invitation.name || "",
    personType: invitation.personType,
    branchId: invitation.branchId,
    branchName: branch?.name || "",
    organizationName: organization?.name || "",
    expiresAt: invitation.expiresAt,
  };
};

const acceptVisitorAccountInvitation = async ({ token, name, password, timezone }) => {
  const invitation = await loadPendingByToken(token);
  if (!validator.isEmail(invitation.email)) throw new AppError("email_invalid", 400);

  let user = await User.findOne({ email: invitation.email });
  if (user && (await isStaffAccount(user))) {
    throw new AppError("email_used_by_staff", 409);
  }
  if (!user && !password) throw new AppError("password_required", 400);

  let resolvedTimezone = timezone;
  if (!user && !resolvedTimezone) {
    const branch = await Branch.findById(invitation.branchId).select("timezone").lean();
    resolvedTimezone = branch?.timezone || "Europe/London";
  }

  const dbSession = await mongoose.startSession();
  try {
    let person;
    await dbSession.withTransaction(async () => {
      if (!user) {
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
          { session: dbSession }
        );
        user = created;
      }

      person = await findPersonByEmail({
        branchId: invitation.branchId,
        email: invitation.email,
        session: dbSession,
      });

      if (person?.userId && String(person.userId) !== String(user._id)) {
        throw new AppError("visitor_account_already_linked", 409);
      }

      const linkedElsewhere = await ExternalPerson.findOne({
        userId: user._id,
        _id: { $ne: person?._id || null },
      }).session(dbSession);
      if (linkedElsewhere) throw new AppError("visitor_account_already_linked", 409);

      if (!person) {
        const [created] = await ExternalPerson.create(
          [
            {
              branchId: invitation.branchId,
              type: invitation.personType,
              name: name || invitation.name || invitation.email,
              email: invitation.email,
              userId: user._id,
            },
          ],
          { session: dbSession }
        );
        person = created;
      } else if (!person.userId) {
        person.userId = user._id;
        if (!person.type) person.type = invitation.personType;
        await person.save({ session: dbSession });
      }

      invitation.status = VisitorAccountInvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
      invitation.acceptedByUserId = user._id;
      invitation.externalPersonId = person._id;
      await invitation.save({ session: dbSession });
    });

    return {
      userId: user._id,
      email: user.email,
      externalPersonId: person._id,
      personType: person.type,
    };
  } catch (error) {
    if (error.code === 11000) throw new AppError("visitor_account_already_linked", 409);
    throw error;
  } finally {
    await dbSession.endSession();
  }
};

module.exports = {
  createVisitorAccountInvitation,
  listVisitorAccountInvitations,
  resendVisitorAccountInvitation,
  revokeVisitorAccountInvitation,
  previewVisitorAccountInvitation,
  acceptVisitorAccountInvitation,
};
