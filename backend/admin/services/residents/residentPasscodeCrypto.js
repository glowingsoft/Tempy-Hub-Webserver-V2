const crypto = require("crypto");
const { AppError } = require("@services/_errors/AppError");

const MIN_SECRET_LENGTH = 16;
const VERSION = "v1";

/**
 * The bcrypt hash verifies a passcode; this encrypted copy only lets a manager see it again.
 * RESIDENT_PASSCODE_SECRET is preferred; without it the key is derived from JWT_SECRET.
 * Changing the secret makes saved passcodes unviewable until they are set again.
 */
const passcodeKey = () => {
  const secret = process.env.RESIDENT_PASSCODE_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new AppError("resident_passcode_secret_missing", 500);
  }
  return Buffer.from(
    crypto.hkdfSync("sha256", secret, "resident-passcode", "display", 32),
  );
};

const encryptPasscode = (passcode) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", passcodeKey(), iv);
  const body = Buffer.concat([
    cipher.update(String(passcode), "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    ...[iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")),
  ].join(".");
};

/** Throws if the text was changed or the key is not the one it was made with. */
const decryptPasscode = (payload) => {
  const [version, iv, tag, body] = String(payload || "").split(".");
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error("unreadable resident passcode");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    passcodeKey(),
    Buffer.from(iv, "base64"),
    { authTagLength: 16 },
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

module.exports = { encryptPasscode, decryptPasscode };
