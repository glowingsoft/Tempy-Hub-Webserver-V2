const crypto = require("crypto");
const mongoose = require("mongoose");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyCode } = require("@models/FamilyCode");
const { AppError } = require("@services/_errors/AppError");
const { FamilyCodeStatus } = require("@models/domainEnums");
const { toObjectId, joinOne } = require("./familyPipeline");
const { hashCode, encryptCode, decryptCode } = require("./familyCodeCrypto");

const CODE_TTL_MS = Number(process.env.FAMILY_CODE_TTL_DAYS || 14) * 24 * 60 * 60 * 1000;
const MAX_CREATE_ATTEMPTS = 5;
const MAX_GENERATE_ATTEMPTS = 50;

// no 0, O, 1 or I, so a code read out over the phone is hard to get wrong
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
    const middle = String(crypto.randomInt(10, 100));
    const tail = randomChars(4);
    if (!room || !`${middle}${tail}`.includes(room)) return `${prefix}-${middle}-${tail}`;
  }

  throw new AppError("family_code_generation_failed", 500);
};

const shapeCode = (doc, code) => ({
  residentId: doc.residentId,
  code,
  expiresAt: doc.expiresAt,
  createdAt: doc.createdAt,
});

const noCode = (residentId) => ({ residentId, code: null, expiresAt: null, createdAt: null });

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

  if (!doc) return noCode(link.residentId);

  try {
    return shapeCode(doc, decryptCode(doc.codeCipher));
  } catch (error) {
    // made with another key (for example after the secret changed): Make A New Code replaces it
    console.error("family code could not be read", error.message);
    return noCode(link.residentId);
  }
};

/** The home's initials and the resident's room number, which a code is built from. */
const codeInputsFor = async (link) => {
  const [info] = await Resident.aggregate([
    { $match: { _id: toObjectId(link.residentId) } },
    ...joinOne({ from: Branch, localField: "branchId", as: "branch", optional: true }),
    { $project: { _id: 0, roomNumber: 1, branchName: "$branch.name" } },
  ]);

  return {
    prefix: codePrefix(info?.branchName || link.organizationName),
    roomNumber: info?.roomNumber,
  };
};

const replaceActiveCode = async ({ link, userId, code }) => {
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
            codeHash: hashCode(code),
            codeCipher: encryptCode(code),
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
            createdBy: userId,
          },
        ],
        { session }
      );
    });

    return created;
  } finally {
    await session.endSession();
  }
};

/** Voids the old code and creates the new one in one transaction; a clash is retried. */
const createCode = async ({ link, userId }) => {
  const inputs = await codeInputsFor(link);

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      const code = generateCode(inputs);
      const created = await replaceActiveCode({ link, userId, code });
      return shapeCode(created, code);
    } catch (error) {
      // 11000: the code already exists, or another request just made one
      if (error.code !== 11000) throw error;
    }
  }

  throw new AppError("family_code_generation_failed", 500);
};

module.exports = {
  codePrefix,
  generateCode,
  getCurrentCode,
  createCode,
};
