const crypto = require("crypto");
const mongoose = require("mongoose");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyCode } = require("@models/FamilyCode");
const { AppError } = require("@services/_errors/AppError");
const { FamilyCodeStatus } = require("@models/domainEnums");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const CODE_TTL_DAYS = Number(process.env.FAMILY_CODE_TTL_DAYS || 14);

// no 0, O, 1 or I, so a code read out over the phone is hard to get wrong
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MAX_ATTEMPTS = 5;

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

/** A code never contains the resident's room number, so it never gives away where they live. */
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

/** Voids the old code and creates the new one in one transaction; a clash is retried. */
const createCode = async ({ link, userId }) => {
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
      // 11000: the code already exists, or another request just made one
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
