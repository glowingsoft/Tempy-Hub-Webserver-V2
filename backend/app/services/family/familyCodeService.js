const crypto = require("crypto");
const mongoose = require("mongoose");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyCode } = require("@models/FamilyCode");
const { AppError } = require("@services/_errors/AppError");
const { FamilyCodeStatus } = require("@models/domainEnums");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const CODE_TTL_DAYS = Number(process.env.FAMILY_CODE_TTL_DAYS || 14);

/** No 0, O, 1 or I, so a code read out over the phone is hard to get wrong. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MAX_ATTEMPTS = 5;

/** Up to three capital letters from the home's name: "Florence House" gives FH. */
const codePrefix = (name) => {
  const initials = String(name || "")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("")
    .slice(0, 3);
  return initials.length >= 2 ? initials : "FM";
};

const randomChars = (length) =>
  Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

/**
 * Builds a code like FH-12-7Q4K: home initials, two digits, four characters.
 * A code that contains the resident's room number is rejected, so a code seen by
 * someone outside the family never gives away where a resident lives.
 */
const generateCode = ({ prefix, roomNumber }) => {
  const room = String(roomNumber || "").replace(/\s+/g, "").toUpperCase();

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const middle = String(crypto.randomInt(10, 100));
    const tail = randomChars(4);
    const code = `${prefix}-${middle}-${tail}`;
    if (!room || !`${middle}${tail}`.includes(room)) return code;
  }

  throw new AppError("family_code_generation_failed", 500);
};

const shapeCode = (doc) =>
  doc
    ? {
        residentId: doc.residentId,
        code: doc.code,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
      }
    : null;

/**
 * The resident's current code, or `code: null` when there is none or it has
 * expired, so the app shows Make A New Code.
 */
const getCurrentCode = async ({ link }) => {
  const [doc] = await FamilyCode.aggregate([
    {
      $match: {
        residentId: toObjectId(link.residentId),
        status: FamilyCodeStatus.ACTIVE,
        expiresAt: { $gt: new Date() },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 1 },
  ]);

  return doc
    ? shapeCode(doc)
    : { residentId: link.residentId, code: null, expiresAt: null, createdAt: null };
};

/**
 * Makes a new code and voids the old one in one transaction. A clash with an
 * existing code, or with a second request made at the same moment, is retried.
 */
const createCode = async ({ link, userId }) => {
  // The room number (kept out of the code) and the home's name, in one read.
  const [info] = await Resident.aggregate([
    { $match: { _id: toObjectId(link.residentId) } },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        as: "branch",
      },
    },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, roomNumber: 1, branchName: "$branch.name" } },
  ]);
  const prefix = codePrefix(info?.branchName || link.organizationName);
  const roomNumber = info?.roomNumber;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let created;

      await session.withTransaction(async () => {
        await FamilyCode.updateMany(
          { residentId: link.residentId, status: FamilyCodeStatus.ACTIVE },
          {
            $set: {
              status: FamilyCodeStatus.VOIDED,
              voidedAt: new Date(),
              voidedBy: userId,
            },
          },
          { session }
        );

        [created] = await FamilyCode.create(
          [
            {
              organizationId: link.organizationId,
              branchId: link.branchId,
              residentId: link.residentId,
              code: generateCode({ prefix, roomNumber }),
              expiresAt: new Date(Date.now() + CODE_TTL_DAYS * 24 * 60 * 60 * 1000),
              createdBy: userId,
            },
          ],
          { session }
        );
      });

      return shapeCode(created);
    } catch (error) {
      // 11000: the code already exists, or another request just made one.
      if (error.code !== 11000) throw error;
    } finally {
      await session.endSession();
    }
  }

  throw new AppError("family_code_generation_failed", 500);
};

module.exports = {
  CODE_TTL_DAYS,
  codePrefix,
  generateCode,
  getCurrentCode,
  createCode,
};
