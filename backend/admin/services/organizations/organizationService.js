const mongoose = require("mongoose");
const { Organization } = require("@models/Organization");
const { Membership } = require("@models/Membership");
const { ModuleDefinition } = require("@models/ModuleDefinition");
const { User } = require("@models/UserModel");
const { StaffInvitation } = require("@models/StaffInvitation");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { nameKeyOf } = require("@utils/nameKey");
const { AppError } = require("@services/_errors/AppError");
const { StaffProfile } = require("@models/StaffProfile");
const {
  MembershipRole,
  ActiveInactiveStatus,
  OrganizationStatus,
  StaffInvitationStatus,
  StaffProfileStatus,
} = require("@models/domainEnums");
  const {
  parseSupervisionInterval,
  parseAppraisalInterval,
  orgCycleDefaults,
  assertAppraisalAfterSupervision,
  assertNoStaffCycleConflict,
} = require("@adminServices/appraisal/cycle");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/** Lean reads skip schema defaults, so older orgs omit fields they never saved. */
const presentSettings = (settings = {}) => {
  const defaults = orgCycleDefaults(settings || {});
  return {
    emergencyNotifyOffsite: Boolean(settings?.emergencyNotifyOffsite),
    defaultSupervisionIntervalMonths: defaults.supervisionMonths,
    defaultAppraisalIntervalMonths: defaults.appraisalMonths,
    appraisalWriterStaffIds: Array.isArray(settings?.appraisalWriterStaffIds)
      ? settings.appraisalWriterStaffIds
      : [],
  };
};

const withSettings = (organization) =>
  organization
    ? { ...organization, settings: presentSettings(organization.settings) }
    : organization;

const writerStaffIds = async (organizationId, value) => {
  if (!Array.isArray(value)) throw new AppError("invalid_appraisal_writers", 400);
  const ids = [
    ...new Set(
      value
        .filter((id) => id != null && String(id).trim() !== "")
        .map((id) => {
          if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new AppError("invalid_staff_profile_id", 400);
          }
          return String(id);
        })
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return [];
  const count = await StaffProfile.countDocuments({
    _id: { $in: ids },
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  });
  if (count !== ids.length) throw new AppError("staff_profile_not_found", 400);
  return ids;
};

const ownerSummaryFromUser = (user) =>
  user
    ? { _id: user._id, name: user.name || "", email: user.email || "" }
    : null;

/**
 * Resolves owner display for list/detail responses.
 * Active orgs use ownerUserId; pendingActivation falls back to the owner invitation.
 */
const attachOwnersToOrganizations = async (organizations) => {
  if (!organizations?.length) return organizations;

  const ownerUserIds = organizations
    .map((org) => org.ownerUserId)
    .filter(Boolean);

  const pendingOwnerOrgIds = organizations
    .filter((org) => !org.ownerUserId)
    .map((org) => org._id);

  const [users, pendingInvitations] = await Promise.all([
    ownerUserIds.length
      ? User.find({ _id: { $in: ownerUserIds } })
        .select("name email")
        .lean()
      : [],
    pendingOwnerOrgIds.length
      ? StaffInvitation.find({
        organizationId: { $in: pendingOwnerOrgIds },
        role: MembershipRole.OWNER,
        status: StaffInvitationStatus.PENDING,
      })
        .select("organizationId email name")
        .lean()
      : [],
  ]);

  const userById = new Map(users.map((user) => [String(user._id), user]));
  const invitationByOrgId = new Map(
    pendingInvitations.map((invitation) => [
      String(invitation.organizationId),
      invitation,
    ])
  );

  return organizations.map((organization) => {
    if (organization.ownerUserId) {
      return {
        ...organization,
        owner: ownerSummaryFromUser(
          userById.get(String(organization.ownerUserId))
        ),
      };
    }

    const invitation = invitationByOrgId.get(String(organization._id));
    return {
      ...organization,
      owner: invitation
        ? { _id: null, name: invitation.name || "", email: invitation.email }
        : null,
    };
  });
};

/**
 * Organizations are sold, not self-served: the platform operator creates each
 * one on behalf of a named owner. Creation happens before any membership exists
 * for that organization, so it cannot be gated by requireMembership.
 */
const assertMayCreateOrganization = (actor) => {
  if (actor.userType !== "admin") {
    throw new AppError("insufficient_role", 403);
  }
};

/** The index is what guarantees uniqueness; this only buys a readable error. */
const assertOrganizationNameFree = async (name, excludeId) => {
  const filter = { nameKey: nameKeyOf(name) };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await Organization.exists(filter)) {
    throw new AppError("organization_name_taken", 409);
  }
};

/**
 * Creates the organization and invites its owner.
 *
 * The organization starts inert: no owner membership exists and every scoped
 * route refuses it until the invited person accepts. That acceptance is what
 * proves the email address is real before the account gains control of a
 * tenant, and it is where the owner sets their own password rather than being
 * handed one.
 */
const createOrganization = async ({
  actor,
  name,
  owner,
  settings,
  moduleAccess,
}) => {
  assertMayCreateOrganization(actor);

  if (!owner?.email) throw new AppError("owner_email_required", 400);

  await assertOrganizationNameFree(name);

  // Entitlements are commercial and independent of activation: what the group
  // bought is known at sale time, whether or not the owner has accepted yet.
  const normalizedModules = moduleAccess
    ? await normalizeModuleAccess(moduleAccess)
    : [];

  const nextSettings = {
    emergencyNotifyOffsite: Boolean(settings?.emergencyNotifyOffsite),
    ...(settings?.defaultSupervisionIntervalMonths !== undefined
      ? {
          defaultSupervisionIntervalMonths: parseSupervisionInterval(
            settings.defaultSupervisionIntervalMonths
          ),
        }
      : {}),
    ...(settings?.defaultAppraisalIntervalMonths !== undefined
      ? {
          defaultAppraisalIntervalMonths: parseAppraisalInterval(
            settings.defaultAppraisalIntervalMonths
          ),
        }
      : {}),
  };
  const createdDefaults = orgCycleDefaults(nextSettings);
  assertAppraisalAfterSupervision(
    createdDefaults.appraisalMonths,
    createdDefaults.supervisionMonths
  );

  let organization;
  try {
    organization = await Organization.create({
      name,
      ownerUserId: null,
      status: OrganizationStatus.PENDING_ACTIVATION,
      moduleAccess: normalizedModules,
      settings: nextSettings,
    });
  } catch (error) {
    // The pre-check races: two requests can both pass it before either inserts.
    if (error.code === 11000) {
      throw new AppError("organization_name_taken", 409);
    }
    throw error;
  }

  // Required here rather than at the top of the file: membershipService reads
  // organization state, so importing it eagerly would close a require cycle.
  const membershipService = require("./membershipService");

  try {
    const invitation = await membershipService.inviteMember({
      actor,
      organizationId: organization._id,
      email: owner.email,
      name: owner.name,
      role: MembershipRole.OWNER,
      branchId: null,
    });

    return { ...withSettings(organization.toObject()), ownerInvitation: invitation };
  } catch (error) {
    // An organization nobody was invited to is unreachable and unnameable, so
    // do not leave it behind holding its name.
    await Organization.deleteOne({ _id: organization._id });
    throw error;
  }
};

/**
 * Called when an owner invitation is redeemed. The organization becomes usable
 * and gains the owner it was created for.
 */
const activateOrganization = async ({ organizationId, ownerUserId, session }) => {
  await Organization.updateOne(
    { _id: organizationId, status: OrganizationStatus.PENDING_ACTIVATION },
    { $set: { status: OrganizationStatus.ACTIVE, ownerUserId } },
    { session }
  );
};

const organizationStatusCountFacets = (countMatch) => {
  const facets = {};
  for (const status of Object.values(OrganizationStatus)) {
    facets[`${status}Count`] = [
      { $match: { ...countMatch, status } },
      { $count: "count" },
    ];
  }
  return facets;
};

const organizationStatusCountsFromFacet = (result) => {
  const counts = {};
  for (const status of Object.values(OrganizationStatus)) {
    counts[status] = facetCount(result[`${status}Count`]);
  }
  return counts;
};

const listOrganizations = async ({ actor, page, limit, skip, keyword, status }) => {
  const match = {};

  if (actor.userType !== "admin") {
    const memberships = await Membership.find({
      userId: actor._id,
      status: ActiveInactiveStatus.ACTIVE,
    })
      .select("organizationId")
      .lean();

    match._id = { $in: memberships.map((m) => m.organizationId) };
  }

  const or = keywordOr(keyword, ["name"], { trim: true });
  if (or) match.$or = or;

  const countMatch = { ...match };
  if (status) {
    if (!Object.values(OrganizationStatus).includes(status)) {
      throw new AppError("invalid_organization_status", 400);
    }
    match.status = status;
  }

  const { data, meta, result } = await paginateWithFacet({
    model: Organization,
    match,
    page,
    limit,
    skip,
    extraFacets: organizationStatusCountFacets(countMatch),
  });

  return {
    data: (await attachOwnersToOrganizations(data)).map(withSettings),
    meta: { ...meta, counts: organizationStatusCountsFromFacet(result) },
  };
};

const getOrganization = async (organizationId) => {
  const organization = await Organization.findById(organizationId).lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  const [withOwner] = await attachOwnersToOrganizations([organization]);
  return withSettings(withOwner);
};

const updateOrganization = async ({ organizationId, name, settings, status }) => {
  const update = {};
  if (name !== undefined) {
    await assertOrganizationNameFree(name, organizationId);
    update.name = name;
    // `findByIdAndUpdate` bypasses document middleware, so the hook cannot help here.
    update.nameKey = nameKeyOf(name);
  }
  if (settings?.emergencyNotifyOffsite !== undefined) {
    update["settings.emergencyNotifyOffsite"] = Boolean(
      settings.emergencyNotifyOffsite
    );
  }
  if (
    settings?.defaultSupervisionIntervalMonths !== undefined ||
    settings?.defaultAppraisalIntervalMonths !== undefined
  ) {
    const current = await Organization.findById(organizationId)
      .select("settings")
      .lean();
    if (!current) throw new AppError("organization_not_found", 404);
    const defaults = orgCycleDefaults(current.settings);
    const nextSup =
      settings.defaultSupervisionIntervalMonths !== undefined
        ? parseSupervisionInterval(settings.defaultSupervisionIntervalMonths)
        : defaults.supervisionMonths;
    const nextApp =
      settings.defaultAppraisalIntervalMonths !== undefined
        ? parseAppraisalInterval(settings.defaultAppraisalIntervalMonths)
        : defaults.appraisalMonths;
    await assertNoStaffCycleConflict({
      organizationId,
      appraisalDefault: nextApp,
      supervisionDefault: nextSup,
    });
    if (settings.defaultSupervisionIntervalMonths !== undefined) {
      update["settings.defaultSupervisionIntervalMonths"] = nextSup;
    }
    if (settings.defaultAppraisalIntervalMonths !== undefined) {
      update["settings.defaultAppraisalIntervalMonths"] = nextApp;
    }
  }
  if (settings?.appraisalWriterStaffIds !== undefined) {
    update["settings.appraisalWriterStaffIds"] = await writerStaffIds(
      organizationId,
      settings.appraisalWriterStaffIds
    );
  }
  if (status !== undefined) {
    if (!Object.values(OrganizationStatus).includes(status)) {
      throw new AppError("invalid_organization_status", 400);
    }
    // pendingActivation is reached only at creation and left only by the owner
    // accepting; allowing it here would let an organization lock itself out.
    if (status === OrganizationStatus.PENDING_ACTIVATION) {
      throw new AppError("invalid_organization_status", 400);
    }
    update.status = status;
  }

  if (!Object.keys(update).length) throw new AppError("nothing_to_update", 400);

  let organization;
  try {
    organization = await Organization.findByIdAndUpdate(
      organizationId,
      { $set: update },
      { new: true, runValidators: true }
    ).lean();
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("organization_name_taken", 409);
    }
    throw error;
  }

  if (!organization) throw new AppError("organization_not_found", 404);
  return withSettings(organization);
};

const getModuleAccess = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("moduleAccess")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);

  const definitions = await ModuleDefinition.find({ active: true }).lean();
  const bySlug = new Map(
    (organization.moduleAccess || []).map((m) => [m.moduleSlug, m])
  );

  return definitions.map((definition) => {
    const entry = bySlug.get(definition.slug);
    return {
      moduleSlug: definition.slug,
      name: definition.name,
      description: definition.description,
      enabled: Boolean(entry?.enabled),
      purchasedAt: entry?.purchasedAt ?? null,
      expiresAt: entry?.expiresAt ?? null,
    };
  });
};

/** Validates an entitlement payload against the catalogue and fills defaults. */
const normalizeModuleAccess = async (moduleAccess) => {
  if (!Array.isArray(moduleAccess)) {
    throw new AppError("module_access_must_be_array", 400);
  }

  const slugs = moduleAccess.map((m) => m?.moduleSlug);
  if (slugs.some((slug) => !slug)) {
    throw new AppError("module_slug_required", 400);
  }
  if (new Set(slugs).size !== slugs.length) {
    throw new AppError("duplicate_module_slug", 400);
  }

  const known = await ModuleDefinition.find({ slug: { $in: slugs } })
    .select("slug")
    .lean();
  const knownSlugs = new Set(known.map((d) => d.slug));
  const unknown = slugs.filter((slug) => !knownSlugs.has(slug));
  if (unknown.length) {
    throw new AppError("unknown_module_slug", 400);
  }

  return moduleAccess.map((entry) => ({
    moduleSlug: entry.moduleSlug,
    enabled: Boolean(entry.enabled),
    purchasedAt: entry.enabled ? entry.purchasedAt || new Date() : null,
    expiresAt: entry.expiresAt || null,
  }));
};

/** Full replacement: the payload is the complete entitlement set for the org. */
const setModuleAccess = async ({ actor, organizationId, moduleAccess }) => {
  // Commercial grants are Philip's only — org owners see access, they do not flip it.
  if (actor?.userType !== "admin") {
    throw new AppError("insufficient_role", 403);
  }

  const normalized = await normalizeModuleAccess(moduleAccess);

  const organization = await Organization.findByIdAndUpdate(
    organizationId,
    { $set: { moduleAccess: normalized } },
    { new: true, runValidators: true }
  )
    .select("moduleAccess")
    .lean();

  if (!organization) throw new AppError("organization_not_found", 404);
  return organization.moduleAccess;
};

const listModuleDefinitions = async ({ page, limit, skip, includeInactive }) => {
  const match = includeInactive ? {} : { active: true };
  return paginateWithFacet({
    model: ModuleDefinition,
    match,
    page,
    limit,
    skip,
    sort: { slug: 1 },
  });
};

module.exports = {
  createOrganization,
  activateOrganization,
  listOrganizations,
  getOrganization,
  updateOrganization,
  getModuleAccess,
  setModuleAccess,
  listModuleDefinitions,
  toObjectId,
};
