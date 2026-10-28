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
const { paginateWithFacet } = require("@utils/paginate");
const { sendTransactionalEmail } = require("@utils/mailer");
const { familyInvitationEmailTemplate } = require("@utils/emailTemplates");
const { AppError } = require("@services/_errors/AppError");
const {
  FamilyInvitationStatus,
  FamilyJoinSource,
  FamilyMemberStatus,
  FamilyRelationship,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayAccessResidents,
} = require("@adminServices/residents/residentAccess");
const {
  isStaffAccount,
  familyModuleOrganizationIds,
} = require("@appServices/family/familyAccessService");
const {
  joinOne,
  isValidObjectId,
} = require("@appServices/family/familyPipeline");
const { searchClause } = require("./familySearch");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const INVITE_TTL_DAYS = Number(process.env.FAMILY_INVITE_TTL_DAYS || 7);

const buildAcceptUrl = (token) => {
  const base = (
    process.env.FAMILY_INVITE_ACCEPT_URL ||
    "http://localhost:3000/family-invite"
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

/** Everything that makes an invitation, once the caller is known to be allowed to send it. */
const createInvitation = async ({
  inviterId,
  organizationId,
  resident,
  email,
  name,
  relationship,
  isNextOfKin = false,
}) => {
  const organization = await Organization.findById(organizationId)
    .select("name")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);

  const normalisedEmail = String(email).trim().toLowerCase();
  if (!validator.isEmail(normalisedEmail)) {
    throw new AppError("email_invalid", 400);
  }

  const existingUser = await User.findOne({ email: normalisedEmail })
    .select("_id accountState.userType")
    .lean();
  if (existingUser) {
    if (await isStaffAccount(existingUser)) {
      throw new AppError("email_used_by_staff", 409);
    }

    const alreadyLinked = await FamilyMember.exists({
      userId: existingUser._id,
      residentId: resident._id,
      status: FamilyMemberStatus.ACTIVE,
    });
    if (alreadyLinked) throw new AppError("family_member_already_exists", 409);
  }

  if (
    await FamilyInvitation.exists({
      residentId: resident._id,
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
      residentId: resident._id,
      email: normalisedEmail,
      name: name || "",
      relationship,
      isNextOfKin: Boolean(isNextOfKin),
      tokenHash: await bcrypt.hash(token, 10),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      invitedByUserId: inviterId,
      lastSentAt: new Date(),
    });
  } catch (error) {
    if (error.code === 11000)
      throw new AppError("invitation_already_pending", 409);
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

const inviteFamilyMember = async ({
  actor,
  organizationId,
  residentId,
  ...fields
}) => {
  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId,
  });
  return createInvitation({
    inviterId: actor._id,
    organizationId,
    resident,
    ...fields,
  });
};

// pending past its expiry reads as expired, since nothing flips the stored status yet
const invitationStatusNow = (now) => ({
  $cond: [
    {
      $and: [
        { $eq: ["$status", FamilyInvitationStatus.PENDING] },
        { $lte: ["$expiresAt", now] },
      ],
    },
    FamilyInvitationStatus.EXPIRED,
    "$status",
  ],
});

const statusCountsOf = (rows = []) => {
  const counts = Object.fromEntries(
    Object.values(FamilyInvitationStatus).map((status) => [status, 0]),
  );
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

const listInvitations = async ({
  organizationId,
  branchId,
  page,
  limit,
  skip,
  status,
  residentId,
  keyword,
}) => {
  if (status && !Object.values(FamilyInvitationStatus).includes(status)) {
    throw new AppError("invalid_status_filter", 400);
  }

  // counts ignore the status filter so every tab keeps its total
  const base = { organizationId: toObjectId(organizationId) };
  if (branchId) base.branchId = toObjectId(branchId);
  if (residentId) base.residentId = toObjectId(residentId);

  const or = await searchClause({
    keyword,
    organizationId,
    branchId,
    fields: ["email", "name"],
    resident: "residentId",
  });
  if (or) base.$or = or;

  const now = new Date();
  const match = status
    ? { ...base, $expr: { $eq: [invitationStatusNow(now), status] } }
    : base;

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyInvitation,
    match,
    page,
    limit,
    skip,
    extraFacets: {
      statusCounts: [
        { $match: base },
        { $group: { _id: invitationStatusNow(now), count: { $sum: 1 } } },
      ],
    },
    extraDataStages: [
      ...joinOne({
        from: Resident,
        localField: "residentId",
        as: "resident",
        optional: true,
      }),
      ...joinOne({
        from: User,
        localField: "invitedByUserId",
        as: "invitedBy",
        optional: true,
      }),
      ...joinOne({
        from: Branch,
        localField: "branchId",
        as: "branch",
        optional: true,
      }),
      {
        $addFields: {
          residentName: { $ifNull: ["$resident.name", ""] },
          roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
          residentPhotoUrl: { $ifNull: ["$resident.photoUrl", ""] },
          homeName: { $ifNull: ["$branch.name", ""] },
          invitedByName: { $ifNull: ["$invitedBy.name", ""] },
        },
      },
      { $addFields: { status: invitationStatusNow(now) } },
      { $project: { tokenHash: 0, resident: 0, invitedBy: 0, branch: 0 } },
    ],
  });

  return {
    data,
    meta: { ...meta, counts: statusCountsOf(result.statusCounts) },
  };
};

const getInvitation = async ({ invitationId, organizationId }) => {
  if (!isValidObjectId(invitationId))
    throw new AppError("invitation_not_found", 404);

  const [invitation] = await FamilyInvitation.aggregate([
    {
      $match: {
        _id: toObjectId(invitationId),
        organizationId: toObjectId(organizationId),
      },
    },
    ...joinOne({
      from: Resident,
      localField: "residentId",
      as: "resident",
      optional: true,
    }),
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    ...joinOne({
      from: User,
      localField: "invitedByUserId",
      as: "invitedBy",
      optional: true,
    }),
    ...joinOne({
      from: User,
      localField: "acceptedByUserId",
      as: "acceptedBy",
      optional: true,
    }),
    ...joinOne({
      from: User,
      localField: "revokedByUserId",
      as: "revokedBy",
      optional: true,
    }),
    {
      $project: {
        _id: 0,
        invitationId: "$_id",
        name: 1,
        email: 1,
        relationship: 1,
        isNextOfKin: 1,
        status: invitationStatusNow(new Date()),
        residentId: 1,
        residentName: { $ifNull: ["$resident.name", ""] },
        roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
        branchId: 1,
        homeName: { $ifNull: ["$branch.name", ""] },
        invitedById: "$invitedByUserId",
        invitedByName: { $ifNull: ["$invitedBy.name", ""] },
        createdAt: 1,
        expiresAt: 1,
        lastSentAt: 1,
        sendCount: 1,
        acceptedAt: 1,
        acceptedByName: { $ifNull: ["$acceptedBy.name", ""] },
        revokedAt: 1,
        revokedByName: { $ifNull: ["$revokedBy.name", ""] },
      },
    },
  ]);
  if (!invitation) throw new AppError("invitation_not_found", 404);

  return invitation;
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
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
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

const MAX_INVITEE_NAME = 120;

/** Fix a pending invitation's name or relationship; the email and link stay as they were. */
const editInvitation = async ({
  actor,
  invitationId,
  organizationId,
  name,
  relationship,
}) => {
  if (!isValidObjectId(invitationId))
    throw new AppError("invitation_not_found", 404);

  const invitation = await FamilyInvitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (
    invitation.status !== FamilyInvitationStatus.PENDING ||
    invitation.expiresAt <= new Date()
  ) {
    throw new AppError("invitation_not_editable", 409);
  }
  await requireManageableResident({
    actor,
    organizationId,
    residentId: invitation.residentId,
  });

  const set = {};
  if (name !== undefined) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > MAX_INVITEE_NAME
    )
      throw new AppError("name_required", 400);
    set.name = name.trim();
  }
  if (relationship !== undefined) {
    if (!Object.values(FamilyRelationship).includes(relationship))
      throw new AppError("invalid_relationship", 400);
    set.relationship = relationship;
  }
  if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);

  const updated = await FamilyInvitation.updateOne(
    { _id: invitation._id, status: FamilyInvitationStatus.PENDING },
    { $set: set },
  );
  if (!updated.matchedCount) throw new AppError("invitation_not_editable", 409);

  return getInvitation({ invitationId, organizationId });
};

/** Only an invitation that went nowhere can be deleted: revoked or expired. An accepted one stays as the record. */
const deleteInvitation = async ({ actor, invitationId, organizationId }) => {
  if (!isValidObjectId(invitationId))
    throw new AppError("invitation_not_found", 404);

  const invitation = await FamilyInvitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  await requireManageableResident({
    actor,
    organizationId,
    residentId: invitation.residentId,
  });

  const lapsed =
    invitation.status === FamilyInvitationStatus.REVOKED ||
    invitation.status === FamilyInvitationStatus.EXPIRED ||
    (invitation.status === FamilyInvitationStatus.PENDING &&
      invitation.expiresAt <= new Date());
  if (!lapsed) throw new AppError("invitation_cannot_be_deleted", 409);

  const removed = await FamilyInvitation.deleteOne({
    _id: invitation._id,
    status: invitation.status,
  });
  if (!removed.deletedCount)
    throw new AppError("invitation_cannot_be_deleted", 409);

  return { invitationId: invitation._id, deleted: true };
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

/** With Family Engagement off an invitation cannot be seen or used: it reads as not found. */
const assertFamilyModuleOn = async (organizationId) => {
  const active = await familyModuleOrganizationIds([organizationId]);
  if (!active.length) throw new AppError("invitation_not_found", 404);
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
      await assertFamilyModuleOn(invitation.organizationId);
      return invitation;
    }
  }

  throw new AppError("invitation_not_found", 404);
};

const shapeInvitationPreview = async (invitation) => {
  const [preview] = await FamilyInvitation.aggregate([
    { $match: { _id: invitation._id } },
    ...joinOne({
      from: Organization,
      localField: "organizationId",
      as: "organization",
      optional: true,
    }),
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    ...joinOne({
      from: Resident,
      localField: "residentId",
      as: "resident",
      optional: true,
    }),
    {
      $lookup: {
        from: User.collection.name,
        localField: "email",
        foreignField: "email",
        as: "accounts",
      },
    },
    {
      $project: {
        _id: 0,
        invitationId: "$_id",
        email: 1,
        name: 1,
        relationship: 1,
        organizationId: 1,
        organizationName: { $ifNull: ["$organization.name", ""] },
        branchId: 1,
        branchName: { $ifNull: ["$branch.name", ""] },
        residentId: 1,
        residentName: { $ifNull: ["$resident.name", ""] },
        residentPhotoUrl: { $ifNull: ["$resident.photoUrl", ""] },
        expiresAt: 1,
        requiresPassword: { $eq: [{ $size: "$accounts" }, 0] },
      },
    },
  ]);
  return preview;
};

const previewInvitation = async (token) => {
  const invitation = await findByToken(token);
  return shapeInvitationPreview(invitation);
};

const listMyInvitations = async ({ user, page, limit, skip }) => {
  const email = String(user.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new AppError("email_required", 400);

  const pending = {
    email,
    status: FamilyInvitationStatus.PENDING,
    expiresAt: { $gt: new Date() },
  };
  const homes = await FamilyInvitation.aggregate([
    { $match: pending },
    { $group: { _id: "$organizationId" } },
  ]);
  const activeHomes = await familyModuleOrganizationIds(
    homes.map((home) => home._id),
  );

  const { data, meta } = await paginateWithFacet({
    model: FamilyInvitation,
    match: { ...pending, organizationId: { $in: activeHomes } },
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
  const email = String(user.email || "")
    .trim()
    .toLowerCase();
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
  await assertFamilyModuleOn(invitation.organizationId);

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

  let user = existingUser || (await User.findOne({ email: invitation.email }));

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
          { session },
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
          { session },
        );
      }

      const linkFields = {
        relationship: invitation.relationship,
        isNextOfKin: invitation.isNextOfKin,
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
          { session },
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
  requireManageableResident,
  createInvitation,
  inviteFamilyMember,
  listInvitations,
  getInvitation,
  editInvitation,
  deleteInvitation,
  resendInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  listMyInvitations,
  getMyInvitation,
  acceptMyInvitation,
};
