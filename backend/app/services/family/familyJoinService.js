const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { FamilyCode } = require("@models/FamilyCode");
const { FamilyMember } = require("@models/FamilyMember");
const {
  FamilyCodeFailure,
  FAMILY_CODE_LOCK_MINUTES,
} = require("@models/FamilyCodeFailure");
const { AppError } = require("@services/_errors/AppError");
const {
  FamilyCodeStatus,
  FamilyJoinSource,
  FamilyMemberStatus,
  FamilyRelationship,
} = require("@models/domainEnums");
const {
  isFamilyModuleActive,
  isStaffAccount,
} = require("./familyAccessService");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");
const { hashCode, normaliseCode } = require("./familyCodeCrypto");
const { notifyJoinRequested } = require("./familyJoinNotifications");

const MAX_FAILED_TRIES = 5;
const LOCK_MS = FAMILY_CODE_LOCK_MINUTES * 60 * 1000;

/** Five failures inside the window lock entry. Tries made while locked are not recorded, so the lock can't be extended. */
const assertNotLocked = async (userId) => {
  const now = Date.now();
  const failures = await FamilyCodeFailure.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        createdAt: { $gt: new Date(now - LOCK_MS) },
      },
    },
    { $sort: { createdAt: 1 } },
    { $limit: MAX_FAILED_TRIES },
    { $project: { _id: 0, createdAt: 1 } },
  ]);
  if (failures.length < MAX_FAILED_TRIES) return;

  const lockedUntil =
    new Date(failures[MAX_FAILED_TRIES - 1].createdAt).getTime() + LOCK_MS;
  const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60000));
  throw new AppError("family_code_locked", 429, { minutes });
};

const failCode = async (userId, translationKey, statusCode) => {
  await FamilyCodeFailure.create({ userId });
  throw new AppError(translationKey, statusCode);
};

const findCodeWithHome = async (value) => {
  const [doc] = await FamilyCode.aggregate([
    { $match: { codeHash: hashCode(value) } },
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
    {
      $project: {
        organizationId: 1,
        branchId: 1,
        residentId: 1,
        status: 1,
        expiresAt: 1,
        "organization.name": 1,
        "organization.moduleAccess": 1,
        "branch.name": 1,
      },
    },
  ]);
  return doc;
};

const isCodeUsable = (doc) =>
  doc.status === FamilyCodeStatus.ACTIVE &&
  new Date(doc.expiresAt) > new Date();

/** Wrong, expired and replaced codes all count towards the lock. Returns the home, never the resident: that is shown only after approval. */
const checkCode = async ({ userId, code }) => {
  await assertNotLocked(userId);

  const value = normaliseCode(code);
  if (!value) throw new AppError("family_code_required", 400);

  const doc = await findCodeWithHome(value);
  if (!doc) return failCode(userId, "family_code_not_found", 404);

  // a replaced code reads the same as an expired one
  if (!isCodeUsable(doc)) return failCode(userId, "family_code_expired", 410);

  // module off: the code is treated as unknown
  if (!doc.organization || !isFamilyModuleActive(doc.organization)) {
    return failCode(userId, "family_code_not_found", 404);
  }

  return { code: doc, homeName: doc.branch?.name || doc.organization.name };
};

const previewCode = async ({ userId, code }) => {
  const { homeName } = await checkCode({ userId, code });
  return { valid: true, homeName };
};

const shapeRequest = (row, homeName) => ({
  requestId: row._id,
  status: row.status,
  homeName,
  relationship: row.relationship,
  requestedAt: row.requestedAt,
});

const assertValidRelationship = (relationship) => {
  if (!Object.values(FamilyRelationship).includes(relationship)) {
    throw new AppError("invalid_relationship", 400);
  }
};

/** Returns the member's earlier link to this family, if any, so a new request can reuse it. */
const assertCanRequest = async (userId, residentId) => {
  const mine = await FamilyMember.aggregate([
    { $match: { userId: toObjectId(userId) } },
    { $project: { residentId: 1, status: 1 } },
  ]);

  // one pending request at a time
  if (mine.some((link) => link.status === FamilyMemberStatus.PENDING)) {
    throw new AppError("join_request_pending", 409);
  }

  const existing = mine.find(
    (link) => String(link.residentId) === String(residentId),
  );
  if (existing?.status === FamilyMemberStatus.ACTIVE) {
    throw new AppError("family_link_exists", 409);
  }
  return existing;
};

const pendingLinkFields = ({ code, relationship }) => ({
  organizationId: code.organizationId,
  branchId: code.branchId,
  relationship,
  isNextOfKin: false,
  status: FamilyMemberStatus.PENDING,
  joinedVia: FamilyJoinSource.CODE,
  requestedAt: new Date(),
  decidedBy: null,
  decidedAt: null,
  removedBy: null,
  removedAt: null,
});

const saveRequest = async ({ userId, code, relationship, existing }) => {
  const fields = pendingLinkFields({ code, relationship });

  try {
    if (existing) {
      // asking again after a rejection, cancellation or removal reuses the row
      return await FamilyMember.findOneAndUpdate(
        { _id: existing._id },
        { $set: fields },
        { new: true },
      ).lean();
    }

    const created = await FamilyMember.create({
      userId,
      residentId: code.residentId,
      ...fields,
    });
    return typeof created.toObject === "function"
      ? created.toObject()
      : created;
  } catch (error) {
    // a double tap: the unique (user, resident) index caught the second request
    if (error.code === 11000) throw new AppError("join_request_pending", 409);
    throw error;
  }
};

const requestToJoin = async ({ user, code: typedCode, relationship }) => {
  assertValidRelationship(relationship);
  if (await isStaffAccount(user))
    throw new AppError("email_used_by_staff", 409);

  const { code, homeName } = await checkCode({
    userId: user._id,
    code: typedCode,
  });
  const existing = await assertCanRequest(user._id, code.residentId);
  const row = await saveRequest({
    userId: user._id,
    code,
    relationship,
    existing,
  });

  await FamilyCodeFailure.deleteMany({ userId: user._id });
  await notifyJoinRequested({ link: row, requesterName: user.name });
  return shapeRequest(row, homeName);
};

const getCurrentRequest = async (userId) => {
  const [row] = await FamilyMember.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        status: FamilyMemberStatus.PENDING,
      },
    },
    { $sort: { requestedAt: -1 } },
    { $limit: 1 },
    ...joinOne({
      from: Branch,
      localField: "branchId",
      as: "branch",
      optional: true,
    }),
    {
      $project: {
        status: 1,
        relationship: 1,
        requestedAt: 1,
        homeName: "$branch.name",
      },
    },
  ]);

  return row ? shapeRequest(row, row.homeName || "") : null;
};

const cancelRequest = async ({ userId, requestId }) => {
  if (!isValidObjectId(requestId))
    throw new AppError("join_request_not_found", 404);

  const [row] = await FamilyMember.aggregate([
    { $match: { _id: toObjectId(requestId), userId: toObjectId(userId) } },
    { $project: { status: 1 } },
  ]);
  if (!row) throw new AppError("join_request_not_found", 404);
  if (row.status !== FamilyMemberStatus.PENDING) {
    throw new AppError("join_request_not_pending", 409);
  }

  await FamilyMember.updateOne(
    { _id: row._id, status: FamilyMemberStatus.PENDING },
    {
      $set: {
        status: FamilyMemberStatus.CANCELLED,
        decidedBy: userId,
        decidedAt: new Date(),
      },
    },
  );

  return { requestId: row._id, status: FamilyMemberStatus.CANCELLED };
};

module.exports = {
  previewCode,
  requestToJoin,
  getCurrentRequest,
  cancelRequest,
};
