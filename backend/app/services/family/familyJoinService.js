const mongoose = require("mongoose");
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

/** Wrong or expired codes allowed inside the lock window before entry is locked. */
const MAX_FAILED_TRIES = 5;
const LOCK_MS = FAMILY_CODE_LOCK_MINUTES * 60 * 1000;

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const normaliseCode = (code) => String(code || "").trim().toUpperCase();

/**
 * Five failures inside the window lock code entry until the fifth failure is a
 * full window old. Entry attempts made while locked are not recorded, so a
 * locked member cannot extend their own lock.
 */
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

  if (failures.length >= MAX_FAILED_TRIES) {
    const lockedUntil = new Date(failures[MAX_FAILED_TRIES - 1].createdAt).getTime() + LOCK_MS;
    const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60000));
    throw new AppError("family_code_locked", 429, { minutes });
  }
};

/** Records the failed try, then throws the reason the member sees. */
const failCode = async (userId, translationKey, statusCode) => {
  await FamilyCodeFailure.create({ userId });
  throw new AppError(translationKey, statusCode);
};

/**
 * Checks a code a member typed. Wrong, expired and replaced codes all count
 * towards the lock. The result names the home but never the resident: the member
 * only sees who the family is for once they are approved.
 */
const checkCode = async ({ userId, code }) => {
  await assertNotLocked(userId);

  const value = normaliseCode(code);
  if (!value) throw new AppError("family_code_required", 400);

  const [doc] = await FamilyCode.aggregate([
    { $match: { code: value } },
    {
      $lookup: {
        from: Organization.collection.name,
        localField: "organizationId",
        foreignField: "_id",
        as: "organization",
      },
    },
    { $unwind: { path: "$organization", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        as: "branch",
      },
    },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
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
  if (!doc) return failCode(userId, "family_code_not_found", 404);

  // A replaced code and an expired one read the same: ask for a new one.
  if (doc.status !== FamilyCodeStatus.ACTIVE || new Date(doc.expiresAt) <= new Date()) {
    return failCode(userId, "family_code_expired", 410);
  }

  // With Family Engagement off the code is as good as unknown.
  if (!doc.organization || !isFamilyModuleActive(doc.organization)) {
    return failCode(userId, "family_code_not_found", 404);
  }

  return {
    code: doc,
    homeName: doc.branch?.name || doc.organization.name,
  };
};

/** Code Accepted card: what the app shows after the member types a valid code. */
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

/** Join A Family: Send Join Request. Creates a pending request for approval. */
const requestToJoin = async ({ user, code, relationship }) => {
  if (!Object.values(FamilyRelationship).includes(relationship)) {
    throw new AppError("invalid_relationship", 400);
  }

  // One email, one role: a staff account cannot be a family member.
  if (await isStaffAccount(user)) throw new AppError("email_used_by_staff", 409);

  const { code: doc, homeName } = await checkCode({ userId: user._id, code });

  // The member's own links, in one read: one request at a time (so the Waiting
  // screen has a single request to show), and no second link to the same family.
  const mine = await FamilyMember.aggregate([
    { $match: { userId: toObjectId(user._id) } },
    { $project: { residentId: 1, status: 1 } },
  ]);
  if (mine.some((m) => m.status === FamilyMemberStatus.PENDING)) {
    throw new AppError("join_request_pending", 409);
  }

  const existing = mine.find((m) => String(m.residentId) === String(doc.residentId));
  if (existing?.status === FamilyMemberStatus.ACTIVE) {
    throw new AppError("family_link_exists", 409);
  }

  const fields = {
    organizationId: doc.organizationId,
    branchId: doc.branchId,
    relationship,
    isNextOfKin: false,
    status: FamilyMemberStatus.PENDING,
    joinedVia: FamilyJoinSource.CODE,
    requestedAt: new Date(),
    decidedBy: null,
    decidedAt: null,
    removedBy: null,
    removedAt: null,
  };

  let row;
  try {
    if (existing) {
      // A rejected, cancelled or removed member asking again reuses their row.
      row = await FamilyMember.findOneAndUpdate(
        { _id: existing._id },
        { $set: fields },
        { new: true }
      ).lean();
    } else {
      const created = await FamilyMember.create({
        userId: user._id,
        residentId: doc.residentId,
        ...fields,
      });
      row = typeof created.toObject === "function" ? created.toObject() : created;
    }
  } catch (error) {
    if (error.code === 11000) throw new AppError("join_request_pending", 409);
    throw error;
  }

  // A good code clears the failed tries.
  await FamilyCodeFailure.deleteMany({ userId: user._id });

  return shapeRequest(row, homeName);
};

/** Request Sent / Waiting: the member's pending request, or null. */
const getCurrentRequest = async (userId) => {
  const [row] = await FamilyMember.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(String(userId)),
        status: FamilyMemberStatus.PENDING,
      },
    },
    { $sort: { requestedAt: -1 } },
    { $limit: 1 },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        as: "branch",
      },
    },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
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

/** Cancel Request: only the member who asked, and only while it is pending. */
const cancelRequest = async ({ userId, requestId }) => {
  if (!mongoose.Types.ObjectId.isValid(requestId)) {
    throw new AppError("join_request_not_found", 404);
  }

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
    }
  );

  return { requestId: row._id, status: FamilyMemberStatus.CANCELLED };
};

module.exports = {
  MAX_FAILED_TRIES,
  previewCode,
  requestToJoin,
  getCurrentRequest,
  cancelRequest,
};
