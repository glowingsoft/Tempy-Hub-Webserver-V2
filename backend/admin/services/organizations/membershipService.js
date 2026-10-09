const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Membership } = require("@models/Membership");
const { Organization } = require("@models/Organization");
const { StaffInvitation } = require("@models/StaffInvitation");
const { JobTitle } = require("@models/JobTitle");
const { Department } = require("@models/Department");
const { ModuleDefinition } = require("@models/ModuleDefinition");
const {
  CATALOGUE,
  getPermission,
  enabledModuleSlugs,
} = require("./permissionCatalogue");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { sendTransactionalEmail } = require("@utils/mailer");
const { staffInvitationEmailTemplate } = require("@utils/emailTemplates");
const { AppError } = require("@services/_errors/AppError");
const {
  MembershipRole,
  MembershipRoleRank,
  ActiveInactiveStatus,
  StaffInvitationStatus,
} = require("@models/domainEnums");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * Most to least privileged. Used to stop anyone granting a role above their own,
 * which would otherwise let a site manager invite themselves back as an owner.
 */
const ROLE_RANK = MembershipRoleRank;

/** Roles that own a specific site rather than the whole organization. */
const BRANCH_SCOPED_ROLES = [
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
  MembershipRole.STAFF,
];

const INVITE_TTL_DAYS = Number(process.env.STAFF_INVITE_TTL_DAYS || 7);

const isPlatformAdmin = (actor) => actor?.userType === "admin";

/**
 * The caller's own standing in this organization. Platform admins are treated as
 * superAdmin so they can administer a tenant they hold no membership in.
 */
const actorStanding = async (actor, organizationId) => {
  if (isPlatformAdmin(actor)) {
    return { role: MembershipRole.SUPER_ADMIN, branchId: null, rank: 5 };
  }

  const memberships = await Membership.find({
    userId: actor._id,
    organizationId,
    status: ActiveInactiveStatus.ACTIVE,
  }).lean();

  if (!memberships.length) throw new AppError("no_membership_for_scope", 403);

  const best = memberships.reduce((a, b) =>
    ROLE_RANK[b.role] > ROLE_RANK[a.role] ? b : a
  );

  return { role: best.role, branchId: best.branchId, rank: ROLE_RANK[best.role] };
};

/**
 * Guards every grant, whether by invitation or by editing an existing member.
 *
 * Two separate concerns: you may not hand out more power than you hold, and a
 * site manager may only act within their own site.
 */
const assertMayGrant = (standing, { role, branchId }) => {
  const targetRank = ROLE_RANK[role];
  if (!targetRank) throw new AppError("invalid_membership_role", 400);

  if (targetRank > standing.rank) {
    throw new AppError("cannot_grant_higher_role", 403);
  }

  if (BRANCH_SCOPED_ROLES.includes(role) && !branchId) {
    throw new AppError("branch_required_for_role", 400);
  }

  if (role === MembershipRole.OWNER && branchId) {
    throw new AppError("owner_cannot_be_branch_scoped", 400);
  }

  // A site manager is confined to the site they manage.
  if (standing.role === MembershipRole.SITE_MANAGER) {
    if (!standing.branchId || String(standing.branchId) !== String(branchId)) {
      throw new AppError("outside_managed_branch", 403);
    }
  }
};

/**
 * Permissions the caller may hand out here: known keys, for a module this
 * organization runs, and not above the caller's own standing.
 */
const grantablePermissions = (standing, organization) => {
  const enabled = enabledModuleSlugs(organization);
  return CATALOGUE.filter(
    (entry) =>
      enabled.has(entry.moduleSlug) &&
      ROLE_RANK[entry.minGrantRole] <= standing.rank
  );
};

const assertPermissionsGrantable = (standing, permissions, organization) => {
  if (!permissions) return;

  if (!Array.isArray(permissions)) {
    throw new AppError("permissions_must_be_array", 400);
  }

  const enabled = enabledModuleSlugs(organization);

  for (const key of permissions) {
    const entry = getPermission(key);
    if (!entry) throw new AppError("unknown_permission", 400, { permission: key });

    if (!enabled.has(entry.moduleSlug)) {
      throw new AppError("module_not_enabled", 403, { module: entry.moduleSlug });
    }

    if (ROLE_RANK[entry.minGrantRole] > standing.rank) {
      throw new AppError("cannot_grant_permission", 403, { permission: key });
    }
  }
};

const assertBranchInOrganization = async (branchId, organizationId) => {
  if (!branchId) return;
  const branch = await Branch.exists({ _id: branchId, organizationId });
  if (!branch) throw new AppError("branch_not_found", 404);
};

/**
 * An organization with no active owner cannot be administered by anyone inside
 * it, so the last one may not be demoted or deactivated.
 */
const assertNotLastOwner = async (membership) => {
  if (
    membership.role !== MembershipRole.OWNER ||
    membership.status !== ActiveInactiveStatus.ACTIVE
  ) {
    return;
  }

  const others = await Membership.countDocuments({
    organizationId: membership.organizationId,
    role: MembershipRole.OWNER,
    status: ActiveInactiveStatus.ACTIVE,
    _id: { $ne: membership._id },
  });

  if (!others) throw new AppError("cannot_remove_last_owner", 400);
};

const listMembers = async ({
  organizationId,
  page,
  limit,
  skip,
  keyword,
  role,
  branchId,
  status,
}) => {
  const match = { organizationId: toObjectId(organizationId) };
  if (role) match.role = role;
  if (branchId) match.branchId = toObjectId(branchId);
  if (status) match.status = status;

  const { data, meta } = await paginateWithFacet({
    model: Membership,
    match,
    page,
    limit,
    skip,
    extraDataStages: [
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
          pipeline: [{ $project: { name: 1, email: 1, profileImage: 1 } }],
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "branches",
          localField: "branchId",
          foreignField: "_id",
          as: "branch",
          pipeline: [{ $project: { name: 1, code: 1 } }],
        },
      },
      { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
    ],
  });

  // Name and email live on the joined user, so filtering happens after $lookup.
  const or = keywordOr(keyword, ["user.name", "user.email"], { trim: true });
  if (!or) return { data, meta };

  const pattern = new RegExp(String(keyword), "i");
  return {
    data: data.filter(
      (row) => pattern.test(row.user?.name || "") || pattern.test(row.user?.email || "")
    ),
    meta,
  };
};

/**
 * What the caller may put in a `permissions` array here, grouped by module so
 * the admin panel can render it directly. Modules the organization has not
 * bought are absent entirely: granting against them would be meaningless.
 */
const listGrantablePermissions = async ({ actor, organizationId }) => {
  const organization = await Organization.findById(organizationId)
    .select("moduleAccess")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  const grantable = grantablePermissions(standing, organization);

  const definitions = await ModuleDefinition.find({
    slug: { $in: [...new Set(grantable.map((entry) => entry.moduleSlug))] },
  })
    .select("slug name description")
    .lean();
  const nameBySlug = new Map(definitions.map((d) => [d.slug, d]));

  const byModule = new Map();
  for (const entry of grantable) {
    if (!byModule.has(entry.moduleSlug)) {
      const definition = nameBySlug.get(entry.moduleSlug);
      byModule.set(entry.moduleSlug, {
        moduleSlug: entry.moduleSlug,
        moduleName: definition?.name || entry.moduleSlug,
        description: definition?.description || "",
        permissions: [],
      });
    }

    byModule.get(entry.moduleSlug).permissions.push({
      key: entry.key,
      verb: entry.verb,
      label: `${entry.verbLabel} ${
        nameBySlug.get(entry.moduleSlug)?.name || entry.moduleSlug
      }`,
    });
  }

  return {
    grantedBy: { role: standing.role },
    modules: [...byModule.values()],
  };
};

const getMembership = async ({ membershipId, organizationId }) => {
  const membership = await Membership.findOne({
    _id: membershipId,
    organizationId,
  }).lean();

  if (!membership) throw new AppError("membership_not_found", 404);
  return membership;
};

const updateMembership = async ({
  actor,
  membershipId,
  organizationId,
  role,
  branchId,
  permissions,
  status,
}) => {
  const membership = await Membership.findOne({
    _id: membershipId,
    organizationId,
  });
  if (!membership) throw new AppError("membership_not_found", 404);

  const standing = await actorStanding(actor, organizationId);

  // Editing someone at or above your own level is off limits, regardless of
  // what the edit actually changes.
  if (ROLE_RANK[membership.role] > standing.rank) {
    throw new AppError("cannot_manage_higher_role", 403);
  }

  const nextRole = role ?? membership.role;
  const nextBranchId =
    branchId === undefined ? membership.branchId : branchId || null;

  assertMayGrant(standing, { role: nextRole, branchId: nextBranchId });

  if (permissions !== undefined) {
    const organization = await Organization.findById(organizationId)
      .select("moduleAccess")
      .lean();
    assertPermissionsGrantable(standing, permissions, organization);
  }

  await assertBranchInOrganization(nextBranchId, organizationId);

  const losingOwnership =
    (role && role !== MembershipRole.OWNER) ||
    status === ActiveInactiveStatus.INACTIVE;
  if (losingOwnership) await assertNotLastOwner(membership);

  membership.role = nextRole;
  membership.branchId = nextBranchId;
  if (permissions !== undefined) membership.permissions = permissions;
  if (status !== undefined) membership.status = status;

  try {
    await membership.save();
  } catch (error) {
    if (error.code === 11000) throw new AppError("membership_already_exists", 409);
    throw error;
  }

  return membership.toObject();
};

const deactivateMembership = async ({ actor, membershipId, organizationId }) => {
  const membership = await Membership.findOne({
    _id: membershipId,
    organizationId,
  });
  if (!membership) throw new AppError("membership_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  if (ROLE_RANK[membership.role] > standing.rank) {
    throw new AppError("cannot_manage_higher_role", 403);
  }

  await assertNotLastOwner(membership);

  membership.status = ActiveInactiveStatus.INACTIVE;
  await membership.save();
  return membership.toObject();
};

const buildAcceptUrl = (token) => {
  const base = (
    process.env.INVITE_ACCEPT_URL || "http://localhost:3000/invite"
  ).replace(/\/+$/, "");
  return `${base}/${token}`;
};

const dispatchInvitation = async ({ invitation, token, organization, branch }) => {
  const acceptUrl = buildAcceptUrl(token);

  await sendTransactionalEmail({
    to: invitation.email,
    subject: `You have been invited to ${organization.name}`,
    html: staffInvitationEmailTemplate({
      inviteeName: invitation.name,
      organizationName: organization.name,
      branchName: branch?.name || "",
      roleLabel: invitation.role,
      acceptUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
    previewUrl: acceptUrl,
  });

  return acceptUrl;
};

const inviteMember = async ({
  actor,
  organizationId,
  email,
  name,
  role,
  branchId,
  permissions,
  jobTitleId,
  departmentIds,
  reportsToStaffId,
  startDate,
  employeeCode,
  isBranchManager = false,
}) => {
  const organization = await Organization.findById(organizationId)
    .select("name moduleAccess")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = branchId || null;

  assertMayGrant(standing, { role, branchId: scopedBranchId });
  assertPermissionsGrantable(standing, permissions, organization);
  await assertBranchInOrganization(scopedBranchId, organizationId);

  const normalisedEmail = String(email).trim().toLowerCase();

  // Checked here rather than only on the User at acceptance: an invitation to a
  // malformed address is undeliverable, and the failure would otherwise surface
  // days later as the invitee tries to redeem it.
  if (!validator.isEmail(normalisedEmail)) {
    throw new AppError("email_invalid", 400);
  }

  let employment = null;
  if (jobTitleId || departmentIds?.length || reportsToStaffId || startDate || employeeCode) {
    if (role === MembershipRole.OWNER) {
      throw new AppError("owner_cannot_be_branch_scoped", 400);
    }
    const staffService = require("@adminServices/staff/staffService");
    employment = await staffService.validateEmploymentAssignment({
      organizationId,
      branchId: scopedBranchId,
      jobTitleId,
      departmentIds,
      reportsToStaffId,
      startDate,
      employeeCode,
    });
  }

  // Someone already inside the organization does not need an invitation.
  const existingUser = await User.findOne({ email: normalisedEmail })
    .select("_id")
    .lean();
  if (existingUser) {
    const alreadyMember = await Membership.exists({
      userId: existingUser._id,
      organizationId,
      branchId: scopedBranchId,
      status: ActiveInactiveStatus.ACTIVE,
    });
    if (alreadyMember) throw new AppError("membership_already_exists", 409);
  }

  if (
    await StaffInvitation.exists({
      organizationId,
      email: normalisedEmail,
      status: StaffInvitationStatus.PENDING,
    })
  ) {
    throw new AppError("invitation_already_pending", 409);
  }

  const token = crypto.randomBytes(32).toString("hex");

  let invitation;
  try {
    invitation = await StaffInvitation.create({
      organizationId,
      branchId: scopedBranchId,
      email: normalisedEmail,
      name: name || "",
      role,
      permissions: permissions || [],
      jobTitleId: employment?.jobTitleId || null,
      departmentIds: employment?.departmentIds || [],
      reportsToStaffId: employment?.reportsToStaffId || null,
      startDate: employment?.startDate || null,
      employeeCode: employment?.employeeCode || null,
      isBranchManager: Boolean(isBranchManager),
      tokenHash: await bcrypt.hash(token, 10),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      invitedByUserId: actor._id,
      lastSentAt: new Date(),
    });
  } catch (error) {
    // The pre-check races: two requests can both pass it before either inserts.
    if (error.code === 11000) throw new AppError("invitation_already_pending", 409);
    throw error;
  }

  const branch = scopedBranchId
    ? await Branch.findById(scopedBranchId).select("name").lean()
    : null;

  const acceptUrl = await dispatchInvitation({
    invitation,
    token,
    organization,
    branch,
  });

  const { tokenHash, ...safe } = invitation.toObject();
  return { ...safe, acceptUrl };
};

const listInvitations = async ({
  organizationId,
  page,
  limit,
  skip,
  status,
  keyword,
}) => {
  const match = { organizationId: toObjectId(organizationId) };
  if (status) match.status = status;

  const or = keywordOr(keyword, ["email", "name"], { trim: true });
  if (or) match.$or = or;

  return paginateWithFacet({
    model: StaffInvitation,
    match,
    page,
    limit,
    skip,
    extraDataStages: [{ $project: { tokenHash: 0 } }],
  });
};

const getInvitation = async ({ invitationId, organizationId }) => {
  const invitation = await StaffInvitation.findOne({
    _id: invitationId,
    organizationId,
  }).lean();

  if (!invitation) throw new AppError("invitation_not_found", 404);

  const { tokenHash, ...safe } = invitation;
  return safe;
};

/** Issues a fresh token: the old one is unrecoverable, only its hash was kept. */
const resendInvitation = async ({ actor, invitationId, organizationId }) => {
  const invitation = await StaffInvitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (invitation.status !== StaffInvitationStatus.PENDING) {
    throw new AppError("invitation_not_pending", 400);
  }

  const standing = await actorStanding(actor, organizationId);
  assertMayGrant(standing, {
    role: invitation.role,
    branchId: invitation.branchId,
  });

  const token = crypto.randomBytes(32).toString("hex");
  invitation.tokenHash = await bcrypt.hash(token, 10);
  invitation.expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  invitation.lastSentAt = new Date();
  invitation.sendCount += 1;
  await invitation.save();

  const organization = await Organization.findById(organizationId)
    .select("name")
    .lean();
  const branch = invitation.branchId
    ? await Branch.findById(invitation.branchId).select("name").lean()
    : null;

  const acceptUrl = await dispatchInvitation({
    invitation,
    token,
    organization,
    branch,
  });

  const { tokenHash, ...safe } = invitation.toObject();
  return { ...safe, acceptUrl };
};

const revokeInvitation = async ({ actor, invitationId, organizationId }) => {
  const invitation = await StaffInvitation.findOne({
    _id: invitationId,
    organizationId,
  });
  if (!invitation) throw new AppError("invitation_not_found", 404);
  if (invitation.status !== StaffInvitationStatus.PENDING) {
    throw new AppError("invitation_not_pending", 400);
  }

  const standing = await actorStanding(actor, organizationId);
  assertMayGrant(standing, {
    role: invitation.role,
    branchId: invitation.branchId,
  });

  invitation.status = StaffInvitationStatus.REVOKED;
  invitation.revokedAt = new Date();
  invitation.revokedByUserId = actor._id;
  // Only the fields being changed are validated, so an invitation holding a
  // malformed address from before that was checked can still be cleaned up.
  await invitation.save({ validateModifiedOnly: true });

  const { tokenHash, ...safe } = invitation.toObject();
  return safe;
};

/**
 * Resolves a plaintext token to its pending invitation.
 *
 * Only the hash is stored, so the token cannot be looked up directly — every
 * pending row has to be compared. Volumes are small and rows are scoped by
 * expiry; revisit if invitation counts ever grow.
 */
const findByToken = async (token) => {
  if (!token) throw new AppError("invitation_not_found", 404);

  const pending = await StaffInvitation.find({
    status: StaffInvitationStatus.PENDING,
  }).select("+tokenHash");

  for (const invitation of pending) {
    if (await bcrypt.compare(String(token), invitation.tokenHash)) {
      if (invitation.expiresAt.getTime() < Date.now()) {
        invitation.status = StaffInvitationStatus.EXPIRED;
        await invitation.save();
        throw new AppError("invitation_expired", 400);
      }
      return invitation;
    }
  }

  throw new AppError("invitation_not_found", 404);
};

const shapeInvitationPreview = async (invitation) => {
  const [organization, branch, jobTitle, departments] = await Promise.all([
    Organization.findById(invitation.organizationId).select("name").lean(),
    invitation.branchId
      ? Branch.findById(invitation.branchId).select("name").lean()
      : null,
    invitation.jobTitleId
      ? JobTitle.findById(invitation.jobTitleId).select("name level").lean()
      : null,
    invitation.departmentIds?.length
      ? Department.find({ _id: { $in: invitation.departmentIds } })
          .select("name")
          .lean()
      : [],
  ]);

  return {
    invitationId: invitation._id,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    organizationId: invitation.organizationId,
    organizationName: organization?.name || "",
    branchId: invitation.branchId,
    branchName: branch?.name || "",
    jobTitle: jobTitle
      ? { _id: jobTitle._id, name: jobTitle.name, level: jobTitle.level }
      : null,
    departments: departments.map((d) => ({ _id: d._id, name: d.name })),
    startDate: invitation.startDate,
    expiresAt: invitation.expiresAt,
    requiresPassword: !(await User.exists({ email: invitation.email })),
  };
};

/** Public preview so the accept screen can show what is being joined. */
const previewInvitation = async (token) => {
  const invitation = await findByToken(token);
  return shapeInvitationPreview(invitation);
};

/**
 * Pending invitations for a logged-in user (matched by email).
 * Lets existing staff accept a second org/branch without digging through email.
 */
const listMyInvitations = async ({ user, page, limit, skip }) => {
  const email = String(user.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new AppError("email_required", 400);

  const match = {
    email,
    status: StaffInvitationStatus.PENDING,
    expiresAt: { $gt: new Date() },
  };

  const { data, meta } = await paginateWithFacet({
    model: StaffInvitation,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: [{ $project: { tokenHash: 0 } }],
  });

  const shaped = await Promise.all(
    data.map(async (row) => shapeInvitationPreview(row))
  );

  return { data: shaped, meta };
};

const requireMyPendingInvitation = async ({ user, invitationId }) => {
  const email = String(user.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new AppError("email_required", 400);

  const invitation = await StaffInvitation.findOne({
    _id: invitationId,
    email,
    status: StaffInvitationStatus.PENDING,
  });

  if (!invitation) throw new AppError("invitation_not_found", 404);

  if (invitation.expiresAt.getTime() < Date.now()) {
    invitation.status = StaffInvitationStatus.EXPIRED;
    await invitation.save({ validateModifiedOnly: true });
    throw new AppError("invitation_expired", 400);
  }

  return invitation;
};

const getMyInvitation = async ({ user, invitationId }) => {
  const invitation = await requireMyPendingInvitation({ user, invitationId });
  return shapeInvitationPreview(invitation);
};

/**
 * Redeems an invitation.
 *
 * An existing account keeps its password and simply gains the membership — a
 * bank nurse working for two care groups is one person with two memberships,
 * and an invitation must never be a way to reset someone else's credentials.
 */
const redeemInvitation = async ({
  invitation,
  existingUser = null,
  name,
  password,
  timezone,
}) => {
  // Invitations issued before the address was validated at send time cannot
  // become accounts. Say so plainly instead of failing deep in user creation.
  if (!validator.isEmail(invitation.email)) {
    throw new AppError("email_invalid", 400);
  }

  let user =
    existingUser || (await User.findOne({ email: invitation.email }));

  if (!user && !password) throw new AppError("password_required", 400);

  // The invitee's timezone is unknown when the invitation is issued, and the
  // account requires one. The site they are joining is the best default.
  let resolvedTimezone = timezone;
  if (!user && !resolvedTimezone) {
    const branch = invitation.branchId
      ? await Branch.findById(invitation.branchId).select("timezone").lean()
      : null;
    resolvedTimezone = branch?.timezone || "Europe/London";
  }

  const session = await mongoose.startSession();
  try {
    let membership;
    let staffProfile = null;

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
              // Redeeming a token that was only ever emailed to this address
              // proves control of the mailbox, so no OTP round trip is needed.
              verificationStatus: { email: "verified" },
            },
          ],
          { session }
        );
        user = created;
      }

      const existing = await Membership.findOne({
        userId: user._id,
        organizationId: invitation.organizationId,
        branchId: invitation.branchId,
      }).session(session);

      if (existing) {
        existing.role = invitation.role;
        existing.permissions = invitation.permissions;
        existing.status = ActiveInactiveStatus.ACTIVE;
        await existing.save({ session });
        membership = existing;
      } else {
        const [created] = await Membership.create(
          [
            {
              userId: user._id,
              organizationId: invitation.organizationId,
              branchId: invitation.branchId,
              role: invitation.role,
              permissions: invitation.permissions,
              status: ActiveInactiveStatus.ACTIVE,
            },
          ],
          { session }
        );
        membership = created;
      }

      invitation.status = StaffInvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
      invitation.acceptedByUserId = user._id;
      await invitation.save({ session });

      // An owner accepting is what brings a newly sold organization to life.
      if (invitation.role === MembershipRole.OWNER) {
        // Required here to avoid a cycle: organizationService creates the
        // owner invitation through this module.
        const organizationService = require("./organizationService");
        await organizationService.activateOrganization({
          organizationId: invitation.organizationId,
          ownerUserId: user._id,
          session,
        });
      }

      if (invitation.jobTitleId && invitation.branchId) {
        const staffService = require("@adminServices/staff/staffService");
        staffProfile = await staffService.insertStaffProfile({
          userId: user._id,
          organizationId: invitation.organizationId,
          branchId: invitation.branchId,
          jobTitleId: invitation.jobTitleId,
          departmentIds: invitation.departmentIds,
          reportsToStaffId: invitation.reportsToStaffId,
          startDate: invitation.startDate,
          employeeCode: invitation.employeeCode,
          session,
        });
      }

      if (invitation.isBranchManager && invitation.branchId) {
        // Drop previous Site Managers on this branch; the invitee is the new one.
        await Membership.updateMany(
          {
            organizationId: invitation.organizationId,
            branchId: invitation.branchId,
            role: MembershipRole.SITE_MANAGER,
            status: ActiveInactiveStatus.ACTIVE,
            userId: { $ne: user._id },
          },
          { $set: { status: ActiveInactiveStatus.INACTIVE } },
          { session }
        );

        await Branch.updateOne(
          { _id: invitation.branchId, organizationId: invitation.organizationId },
          { $set: { managerUserId: user._id } },
          { session }
        );
      }
    });

    return {
      membership: membership.toObject(),
      userId: user._id,
      email: user.email,
      staffProfile: staffProfile ? staffProfile.toObject() : null,
    };
  } catch (error) {
    if (error.code === 11000) throw new AppError("membership_already_exists", 409);
    throw error;
  } finally {
    await session.endSession();
  }
};

const acceptInvitation = async ({ token, name, password, timezone }) => {
  const invitation = await findByToken(token);
  return redeemInvitation({ invitation, name, password, timezone });
};

/**
 * Logged-in user accepts one of their pending invitations.
 * No password — email ownership is already proven by the session.
 */
const acceptMyInvitation = async ({ user, invitationId }) => {
  const invitation = await requireMyPendingInvitation({ user, invitationId });
  return redeemInvitation({ invitation, existingUser: user });
};

module.exports = {
  listMembers,
  listGrantablePermissions,
  getMembership,
  updateMembership,
  deactivateMembership,
  inviteMember,
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
