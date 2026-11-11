const crypto = require("crypto");

// Rotating Visit Pass token: `<inviteCode>.<window>.<signature>`, resolved back to the code by the kiosk.
const WINDOW_SECONDS = 30;
const ACCEPTED_PAST_WINDOWS = 1;
const SIGNATURE_LENGTH = 16;
const TOKEN = /^(\d+)\.(\d+)\.([a-f0-9]+)$/;

const secret = () =>
  process.env.FAMILY_CODE_SECRET || process.env.JWT_SECRET || "";

const windowOf = (now) => Math.floor(now.getTime() / 1000 / WINDOW_SECONDS);

const sign = (code, window) =>
  crypto
    .createHmac("sha256", secret())
    .update(`visit-pass:${code}.${window}`)
    .digest("hex")
    .slice(0, SIGNATURE_LENGTH);

const PAYLOAD_PREFIX = "tempyhub://visit-pass?token=";

const payloadOf = (token) => `${PAYLOAD_PREFIX}${token}`;

const unwrapPayload = (text) => {
  if (!text.startsWith(PAYLOAD_PREFIX)) return text;
  const rest = text.slice(PAYLOAD_PREFIX.length);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
};

const issue = (code, now = new Date()) => {
  const window = windowOf(now);
  const expiresAt = new Date((window + 1) * WINDOW_SECONDS * 1000);
  const token = `${code}.${window}.${sign(code, window)}`;
  return {
    token,
    qrPayload: payloadOf(token),
    windowSeconds: WINDOW_SECONDS,
    expiresAt,
    refreshInSeconds: Math.max(
      0,
      Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
    ),
  };
};

// The code inside a valid token; plain codes, forged and expired tokens come back unchanged and match nothing.
const resolve = (value, now = new Date()) => {
  const raw = String(value || "").trim();
  const text = unwrapPayload(raw);
  const match = TOKEN.exec(text);
  if (!match || !secret()) return text;

  const [, code, windowText, signature] = match;
  const window = Number(windowText);
  const current = windowOf(now);
  if (window > current || current - window > ACCEPTED_PAST_WINDOWS) return text;

  const expected = Buffer.from(sign(code, window));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return text;
  return crypto.timingSafeEqual(expected, given) ? code : text;
};

module.exports = { issue, resolve, WINDOW_SECONDS };
