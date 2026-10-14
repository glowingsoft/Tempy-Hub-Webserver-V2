const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { BranchActivationCode } = require("@models/BranchActivationCode");
const { User } = require("@models/UserModel");
const { Membership } = require("@models/Membership");
const { StaffProfile } = require("@models/StaffProfile");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { nameKeyOf } = require("@utils/nameKey");
const { AppError } = require("@services/_errors/AppError");
const {
  BranchStatus,
  ActivationCodeStatus,
  MembershipRole,
  ActiveInactiveStatus,
} = require("@models/domainEnums");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const randomCode = (length) =>
  Array.from(crypto.randomBytes(length))
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join("");

/** `randomInt` rather than `randomBytes % 10`, which biases towards 0–5. */
const randomDigits = (length) =>
  Array.from({ length }, () => crypto.randomInt(0, 10)).join("");

const BRANCH_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

const normalizeBranchCode = (value) => String(value).trim().toUpperCase();

const assertValidBranchCode = (code) => {
  if (!BRANCH_CODE_PATTERN.test(code)) {
    throw new AppError("invalid_branch_code", 400);
  }
};

const assertBranchCodeFree = async (organizationId, code, excludeId) => {
  const filter = { organizationId, code };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await Branch.exists(filter)) throw new AppError("branch_code_taken", 409);
};

const duplicateBranchKeyError = (error) => {
  if (error?.code !== 11000) return null;
  const key = Object.keys(error.keyPattern || {})[0];
  if (key === "code") return new AppError("branch_code_taken", 409);
  return new AppError("branch_name_taken", 409);
};

/**
 * Branch ID shown in the UI. Unique per organization, so a collision only means
 * retrying — the unique index is what actually guarantees it.
 */
const generateBranchCode = async (organizationId) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `BR-${randomCode(6)}`;
    const exists = await Branch.exists({ organizationId, code });
    if (!exists) return code;
  }
  throw new AppError("branch_code_generation_failed", 500);
};

const resolveBranchCode = async (organizationId, requested) => {
  if (requested == null || String(requested).trim() === "") {
    return generateBranchCode(organizationId);
  }
  const code = normalizeBranchCode(requested);
  assertValidBranchCode(code);
  await assertBranchCodeFree(organizationId, code);
  return code;
};

const SETTING_FIELDS = [
  "enableBreaks",
  "lateGraceMinutes",
  "allowPhoneCheckIn",
  "paidBreaks",
  "enableLeaveRequests",
];

const normalizeBreakBands = (bands) => {
  if (!Array.isArray(bands)) {
    throw new AppError("invalid_break_bands", 400);
  }
  return bands.map((band) => {
    const minShiftHours = Number(band?.minShiftHours);
    const fromMinutes =
      band?.unpaidBreakMinutes !== undefined
        ? Number(band.unpaidBreakMinutes) / 60
        : undefined;
    const unpaidBreakHours = Number(
      fromMinutes !== undefined ? fromMinutes : band?.unpaidBreakHours
    );
    if (
      !Number.isFinite(minShiftHours) ||
      !Number.isFinite(unpaidBreakHours) ||
      minShiftHours < 0 ||
      unpaidBreakHours < 0
    ) {
      throw new AppError("invalid_break_bands", 400);
    }
    return { minShiftHours, unpaidBreakHours };
  });
};

const buildSettings = (settings) => ({
  enableBreaks: Boolean(settings?.enableBreaks),
  lateGraceMinutes:
    settings?.lateGraceMinutes === undefined
      ? 5
      : Number(settings.lateGraceMinutes),
  allowPhoneCheckIn: Boolean(settings?.allowPhoneCheckIn),
  paidBreaks: Boolean(settings?.paidBreaks),
  enableLeaveRequests:
    settings?.enableLeaveRequests === undefined
      ? true
      : Boolean(settings.enableLeaveRequests),
  ...(settings?.breakBands !== undefined
    ? { breakBands: normalizeBreakBands(settings.breakBands) }
    : {}),
});

const applyManager = async ({ actor, organizationId, branchId, manager }) => {
  if (manager.userId) {
    await assignExistingBranchManager({
      organizationId,
      branchId,
      userId: manager.userId,
    });
    return { managerUserId: manager.userId, managerInvitation: null };
  }

  if (manager.email) {
    if (!actor) throw new AppError("auth_token_missing", 401);
    const membershipService = require("./membershipService");
    const managerInvitation = await membershipService.inviteMember({
      actor,
      organizationId,
      email: manager.email,
      name: manager.name,
      role: MembershipRole.SITE_MANAGER,
      branchId,
      permissions: manager.permissions,
      jobTitleId: manager.jobTitleId,
      departmentIds: manager.departmentIds,
      reportsToStaffId: manager.reportsToStaffId,
      startDate: manager.startDate,
      employeeCode: manager.employeeCode,
      isBranchManager: true,
    });
    return { managerUserId: null, managerInvitation };
  }

  throw new AppError("branch_manager_user_or_email_required", 400);
};

/**
 * Names are unique per organization, not globally — two care groups may each
 * have a "Main entrance". The index enforces it; this only buys a readable error.
 */
const assertBranchNameFree = async (organizationId, name, excludeId) => {
  const filter = { organizationId, nameKey: nameKeyOf(name) };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await Branch.exists(filter)) {
    throw new AppError("branch_name_taken", 409);
  }
};

/**
 * Soft-revokes Site Manager scope on one branch for a user (membership → inactive).
 * Does not touch other branches or org-wide roles.
 */
const revokeBranchSiteManagerScope = async ({
  organizationId,
  branchId,
  userId,
}) => {
  if (!userId) return;

  await Membership.updateOne(
    {
      userId,
      organizationId,
      branchId,
      role: MembershipRole.SITE_MANAGER,
      status: ActiveInactiveStatus.ACTIVE,
    },
    { $set: { status: ActiveInactiveStatus.INACTIVE } }
  );
};

/**
 * Ensures only `keepUserId` (if any) remains an active Site Manager on this branch.
 * Clears leftover scope when managers were reassigned without revocation.
 */
const revokeOtherBranchSiteManagers = async ({
  organizationId,
  branchId,
  keepUserId = null,
}) => {
  const filter = {
    organizationId,
    branchId,
    role: MembershipRole.SITE_MANAGER,
    status: ActiveInactiveStatus.ACTIVE,
  };
  if (keepUserId) filter.userId = { $ne: keepUserId };

  await Membership.updateMany(filter, {
    $set: { status: ActiveInactiveStatus.INACTIVE },
  });
};

/**
 * Makes someone the site manager for a branch and records them on the branch row.
 * Revokes any other active Site Manager memberships on this branch first.
 */
const assignExistingBranchManager = async ({
  organizationId,
  branchId,
  userId,
}) => {
  const user = await User.findById(userId).select("_id").lean();
  if (!user) throw new AppError("user_not", 404);

  await revokeOtherBranchSiteManagers({
    organizationId,
    branchId,
    keepUserId: userId,
  });

  const existing = await Membership.findOne({
    userId,
    organizationId,
  });

  if (existing?.status === ActiveInactiveStatus.ACTIVE) {
    if (existing.role === MembershipRole.OWNER) {
      throw new AppError("owner_cannot_be_branch_manager", 400);
    }
    if (existing.role !== MembershipRole.SITE_MANAGER) {
      const hasProfile = await StaffProfile.exists({ userId, organizationId });
      if (hasProfile) throw new AppError("manager_cannot_have_staff_profile", 400);
    }
    existing.role = MembershipRole.SITE_MANAGER;
    existing.branchId = branchId;
    existing.status = ActiveInactiveStatus.ACTIVE;
    await existing.save({ validateModifiedOnly: true });
  } else if (existing) {
    if (existing.role === MembershipRole.OWNER && !existing.branchId) {
      throw new AppError("owner_cannot_be_branch_manager", 400);
    }
    existing.role = MembershipRole.SITE_MANAGER;
    existing.branchId = branchId;
    existing.status = ActiveInactiveStatus.ACTIVE;
    await existing.save({ validateModifiedOnly: true });
  } else {
    const hasProfile = await StaffProfile.exists({ userId, organizationId });
    if (hasProfile) throw new AppError("manager_cannot_have_staff_profile", 400);

    try {
      await Membership.create({
        userId,
        organizationId,
        branchId,
        role: MembershipRole.SITE_MANAGER,
        status: ActiveInactiveStatus.ACTIVE,
      });
    } catch (error) {
      if (error.code === 11000) throw new AppError("membership_already_exists", 409);
      throw error;
    }
  }

  await Branch.updateOne(
    { _id: branchId, organizationId },
    { $set: { managerUserId: userId } }
  );
};

const createBranch = async ({
  actor,
  organizationId,
  name,
  code: requestedCode,
  address,
  timezone,
  assemblyPoint,
  settings,
  manager,
}) => {
  const organization = await Organization.exists({ _id: organizationId });
  if (!organization) throw new AppError("organization_not_found", 404);

  await assertBranchNameFree(organizationId, name);
  const code = await resolveBranchCode(organizationId, requestedCode);

  const payload = {
    organizationId,
    name,
    code,
    address: address ?? null,
    timezone: timezone || "Europe/London",
    assemblyPoint: assemblyPoint || "",
    settings: buildSettings(settings),
    status: BranchStatus.PENDING_ACTIVATION,
  };

  try {
    const branch = await Branch.create(payload);
    const result = branch.toObject();

    if (!manager) return result;

    const applied = await applyManager({
      actor,
      organizationId,
      branchId: branch._id,
      manager,
    });
    if (applied.managerUserId) result.managerUserId = applied.managerUserId;
    return applied.managerInvitation
      ? { ...result, managerInvitation: applied.managerInvitation }
      : result;
  } catch (error) {
    const duplicate = duplicateBranchKeyError(error);
    if (duplicate) throw duplicate;
    throw error;
  }
};

const branchStatusCountFacets = (countMatch) => {
  const facets = {};
  for (const status of Object.values(BranchStatus)) {
    facets[`${status}Count`] = [
      { $match: { ...countMatch, status } },
      { $count: "count" },
    ];
  }
  return facets;
};

const branchStatusCountsFromFacet = (result) => {
  const counts = {};
  for (const status of Object.values(BranchStatus)) {
    counts[status] = facetCount(result[`${status}Count`]);
  }
  return counts;
};

const listBranches = async ({
  organizationId,
  page,
  limit,
  skip,
  keyword,
  status,
}) => {
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };

  const or = keywordOr(keyword, ["name", "code"], { trim: true });
  if (or) match.$or = or;

  const countMatch = { ...match };
  if (status) {
    if (!Object.values(BranchStatus).includes(status)) {
      throw new AppError("invalid_branch_status", 400);
    }
    match.status = status;
  }

  const { data, meta, result } = await paginateWithFacet({
    model: Branch,
    match,
    page,
    limit,
    skip,
    extraFacets: branchStatusCountFacets(countMatch),
  });

  return {
    data,
    meta: { ...meta, counts: branchStatusCountsFromFacet(result) },
  };
};

/**
 * Branch routes carry no organization in the path, so every lookup is pinned to
 * the caller's resolved scope — otherwise an org id header would be enough to
 * read another tenant's branch.
 */
const getBranch = async ({ branchId, organizationId }) => {
  const branch = await Branch.findOne({
    _id: branchId,
    organizationId,
  }).lean();
  if (!branch) throw new AppError("branch_not_found", 404);
  return branch;
};

const updateBranch = async ({
  actor,
  branchId,
  organizationId,
  name,
  code: requestedCode,
  address,
  timezone,
  assemblyPoint,
  settings,
  emergencyPin,
  status,
  managerUserId,
  manager,
}) => {
  const update = {};
  if (name !== undefined) {
    await assertBranchNameFree(organizationId, name, branchId);
    update.name = name;
    update.nameKey = nameKeyOf(name);
  }
  if (requestedCode !== undefined) {
    const code = normalizeBranchCode(requestedCode);
    assertValidBranchCode(code);
    await assertBranchCodeFree(organizationId, code, branchId);
    update.code = code;
  }
  if (address !== undefined) update.address = address;
  if (timezone !== undefined) update.timezone = timezone;
  if (assemblyPoint !== undefined) update.assemblyPoint = assemblyPoint;

  if (settings) {
    for (const field of SETTING_FIELDS) {
      if (settings[field] === undefined) continue;
      update[`settings.${field}`] =
        field === "lateGraceMinutes"
          ? Number(settings[field])
          : Boolean(settings[field]);
    }

    if (settings.breakBands !== undefined) {
      update["settings.breakBands"] = normalizeBreakBands(settings.breakBands);
    }
  }

  if (emergencyPin !== undefined) {
    if (!/^\d{4,8}$/.test(String(emergencyPin))) {
      throw new AppError("invalid_emergency_pin", 400);
    }
    update.emergencyPinHash = await bcrypt.hash(String(emergencyPin), 10);
  }

  if (status !== undefined) {
    if (!Object.values(BranchStatus).includes(status)) {
      throw new AppError("invalid_branch_status", 400);
    }
    update.status = status;
    if (status === BranchStatus.ACTIVE) update.activatedAt = new Date();
  }

  const clearingManager = manager === null || managerUserId === null;
  if (clearingManager) {
    await revokeOtherBranchSiteManagers({
      organizationId,
      branchId,
      keepUserId: null,
    });
    update.managerUserId = null;
  } else if (managerUserId) {
    await assignExistingBranchManager({
      organizationId,
      branchId,
      userId: managerUserId,
    });
  }

  const hasManagerInvite = Boolean(manager && !clearingManager);
  if (
    !Object.keys(update).length &&
    managerUserId === undefined &&
    manager === undefined
  ) {
    throw new AppError("nothing_to_update", 400);
  }

  let branch;
  if (Object.keys(update).length) {
    try {
      branch = await Branch.findOneAndUpdate(
        { _id: branchId, organizationId },
        { $set: update },
        { new: true, runValidators: true }
      ).lean();
    } catch (error) {
      const duplicate = duplicateBranchKeyError(error);
      if (duplicate) throw duplicate;
      throw error;
    }
    if (!branch) throw new AppError("branch_not_found", 404);
  } else {
    branch = await getBranch({ branchId, organizationId });
  }

  if (!hasManagerInvite) return branch;

  const applied = await applyManager({
    actor,
    organizationId,
    branchId,
    manager,
  });
  return applied.managerInvitation
    ? { ...branch, managerInvitation: applied.managerInvitation }
    : { ...branch, managerUserId: applied.managerUserId || branch.managerUserId };
};

const ACTIVATION_CODE_LENGTH = 4;
const MAX_FAILED_ATTEMPTS = 5;
/**
 * Short by design. A 4-digit code is only 10,000 combinations, so its lifetime
 * and attempt budget carry the security rather than its length.
 */
const DEFAULT_CODE_TTL_HOURS = 12;

/**
 * The plaintext code is returned exactly once; only its hash is stored, so a
 * lost code has to be reissued rather than recovered.
 *
 * Issuing supersedes any code still live for the branch, so at most one of the
 * 10,000 possible codes is guessable at a time.
 */
const issueActivationCode = async ({
  branchId,
  organizationId,
  issuedByUserId,
  issuedToUserId,
  expiresInHours,
  kioskId = null,
}) => {
  const branch = await Branch.findOne({ _id: branchId, organizationId })
    .select("organizationId")
    .lean();
  if (!branch) throw new AppError("branch_not_found", 404);

  const code = randomDigits(ACTIVATION_CODE_LENGTH);
  const ttlHours = Number(expiresInHours) > 0
    ? Number(expiresInHours)
    : DEFAULT_CODE_TTL_HOURS;

  const revokeFilter = { branchId, status: ActivationCodeStatus.ACTIVE };
  if (kioskId) revokeFilter.kioskId = kioskId;
  else {
    revokeFilter.$or = [{ kioskId: null }, { kioskId: { $exists: false } }];
  }

  await BranchActivationCode.updateMany(revokeFilter, {
    $set: { status: ActivationCodeStatus.REVOKED },
  });

  const payload = {
    branchId,
    organizationId: branch.organizationId,
    codeHash: await bcrypt.hash(code, 10),
    issuedByUserId,
    issuedToUserId: issuedToUserId || undefined,
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    status: ActivationCodeStatus.ACTIVE,
  };
  if (kioskId) payload.kioskId = kioskId;

  const record = await BranchActivationCode.create(payload);

  const { codeHash, ...safe } = record.toObject();
  return { ...safe, code };
};

const listActivationCodes = async ({
  branchId,
  organizationId,
  page,
  limit,
  skip,
  status,
}) => {
  const match = {
    branchId: new mongoose.Types.ObjectId(String(branchId)),
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };
  if (status) match.status = status;

  return paginateWithFacet({
    model: BranchActivationCode,
    match,
    page,
    limit,
    skip,
    extraDataStages: [{ $project: { codeHash: 0 } }],
  });
};

const revokeActivationCode = async ({
  branchId,
  organizationId,
  activationCodeId,
}) => {
  const record = await BranchActivationCode.findOne({
    _id: activationCodeId,
    branchId,
    organizationId,
  });

  if (!record) throw new AppError("activation_code_not_found", 404);
  if (record.status !== ActivationCodeStatus.ACTIVE) {
    throw new AppError("activation_code_not_active", 400);
  }

  record.status = ActivationCodeStatus.REVOKED;
  await record.save();

  const { codeHash, ...safe } = record.toObject();
  return safe;
};

/**
 * Checks a code presented during device registration and consumes it on success.
 *
 * Every failure costs one of `MAX_FAILED_ATTEMPTS`; exhausting the budget locks
 * the code so a 4-digit space cannot be walked. Callers should also rate-limit
 * by IP, since locking one code does not stop an attacker moving to the next.
 */
const verifyActivationCode = async ({ branchId, code }) => {
  const records = await BranchActivationCode.find({
    branchId,
    status: ActivationCodeStatus.ACTIVE,
  }).select("+codeHash");

  if (!records.length) throw new AppError("activation_code_not_found", 404);

  const now = Date.now();
  for (const record of records) {
    if (record.expiresAt && record.expiresAt.getTime() < now) {
      record.status = ActivationCodeStatus.EXPIRED;
      await record.save();
      continue;
    }

    if (!(await bcrypt.compare(String(code), record.codeHash))) continue;

    record.status = ActivationCodeStatus.USED;
    record.usedAt = new Date();
    await record.save();
    const { codeHash, ...safe } = record.toObject();
    return safe;
  }

  const stillActive = records.filter(
    (row) => row.status === ActivationCodeStatus.ACTIVE
  );
  if (!stillActive.length) throw new AppError("activation_code_expired", 400);

  throw new AppError("activation_code_invalid", 400);
};

module.exports = {
  createBranch,
  listBranches,
  getBranch,
  updateBranch,
  assignExistingBranchManager,
  revokeOtherBranchSiteManagers,
  revokeBranchSiteManagerScope,
  issueActivationCode,
  listActivationCodes,
  revokeActivationCode,
  verifyActivationCode,
};
