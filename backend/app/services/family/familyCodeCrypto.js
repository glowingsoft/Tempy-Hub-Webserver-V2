const crypto = require("crypto");
const { AppError } = require("@services/_errors/AppError");

const MIN_SECRET_LENGTH = 16;
const VERSION = "v1";

let derived = { secret: null, lookupKey: null, displayKey: null };

/**
 * A family code is never stored as typed. Two keys are derived from one server secret: one
 * to look a code up (a keyed hash, so a database leak cannot be used to guess codes offline)
 * and one to show the code again to the next of kin (the screen has a Copy button).
 * FAMILY_CODE_SECRET is preferred; without it the key is derived from JWT_SECRET.
 */
const keys = () => {
  const secret = process.env.FAMILY_CODE_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH)
    throw new AppError("family_code_secret_missing", 500);

  if (derived.secret !== secret) {
    const derive = (info) =>
      Buffer.from(crypto.hkdfSync("sha256", secret, "family-code", info, 32));
    derived = {
      secret,
      lookupKey: derive("lookup"),
      displayKey: derive("display"),
    };
  }
  return derived;
};

const normalise = (code) =>
  String(code || "")
    .trim()
    .toUpperCase();

const hashCode = (code) =>
  crypto
    .createHmac("sha256", keys().lookupKey)
    .update(normalise(code))
    .digest("hex");

const encryptCode = (code) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys().displayKey, iv);
  const body = Buffer.concat([
    cipher.update(normalise(code), "utf8"),
    cipher.final(),
  ]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (Buffer.isBuffer(part) ? part.toString("base64") : part))
    .join(".");
};

/** Throws if the text was changed or the key is not the one it was made with. */
const decryptCode = (payload) => {
  const [version, iv, tag, body] = String(payload || "").split(".");
  if (version !== VERSION || !iv || !tag || !body)
    throw new Error("unreadable family code");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keys().displayKey,
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

module.exports = {
  hashCode,
  encryptCode,
  decryptCode,
  normaliseCode: normalise,
};
