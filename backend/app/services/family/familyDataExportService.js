const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { createHmac, randomUUID, timingSafeEqual } = require("crypto");
const { User } = require("@models/UserModel");
const { FamilyDataExport } = require("@models/FamilyDataExport");
const { NotificationTypes } = require("@models/Notifications");
const { FamilyDataExportStatus } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { sendTransactionalEmail } = require("@utils/mailer");
const { frontendLink } = require("@utils/frontendUrl");
const { familyDataReadyEmailTemplate } = require("@utils/emailTemplates");
const { buildArchive } = require("./familyDataExportArchive");
const { notify, quietly } = require("./familyNotify");

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_DAYS = Number(process.env.FAMILY_DATA_EXPORT_TTL_DAYS || 7);
const LINK_MS = 5 * 60 * 1000;
/** A build claimed longer ago than this is taken to have died with its server. */
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BATCH = 5;
const ScreenStatus = { NOT_REQUESTED: "notRequested" };

const userOf = async (userId) => {
  const user = await User.findById(userId).select("name email password").lean();
  if (!user) throw new AppError("user_not", 404);
  return user;
};

const isReady = (row, now) =>
  row?.status === FamilyDataExportStatus.READY && row.expiresAt > now;

/** What the Download My Data screen shows: notRequested, preparing or ready. */
const shapeState = ({ row, user, now }) => {
  const preparing = row?.status === FamilyDataExportStatus.PREPARING;
  const ready = isReady(row, now);
  return {
    status: ready || preparing ? row.status : ScreenStatus.NOT_REQUESTED,
    email: user.email || "",
    requestedAt: ready || preparing ? row.requestedAt : null,
    preparedAt: ready ? row.preparedAt : null,
    expiresAt: ready ? row.expiresAt : null,
    fileName: ready ? row.fileName : "",
    fileSize: ready ? row.size : 0,
    passwordRequired: Boolean(user.password),
    // the last request could not be prepared, so the person has to ask again
    failed: row?.status === FamilyDataExportStatus.FAILED,
  };
};

const getState = async ({ userId, now = new Date() }) => {
  const [user, row] = await Promise.all([
    userOf(userId),
    FamilyDataExport.findOne({ userId }).lean(),
  ]);
  return shapeState({ row, user, now });
};

const removeFile = async (key) => {
  if (!key) return;
  try {
    await uploadAwsService.deleteFiles(key);
  } catch (error) {
    console.error("family data export file not deleted", key, error.message);
  }
};

const fileNameFor = (name) => {
  const words = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5);
  return `${words.join("-") || "My"}-Data.zip`;
};

/** Tells the person by email and in the app. Neither failing undoes the finished file. */
const announce = async ({ row, user, expiresAt }) => {
  const appUrl = frontendLink(
    "FAMILY_DATA_EXPORT_URL",
    "/family/download-my-data",
  );
  await quietly(() =>
    sendTransactionalEmail({
      to: user.email,
      subject: "Your Tempy Hub data is ready",
      html: familyDataReadyEmailTemplate({
        name: user.name,
        appUrl,
        expiresAt,
      }),
      previewUrl: appUrl,
    }),
  );
  await quietly(() =>
    notify({
      type: NotificationTypes.FAMILY_DATA_EXPORT,
      receivers: [row.userId],
      subjectId: null,
      objectId: row.requestId,
      objectType: "familyDataExport",
      title: "Your data is ready",
      body: `Download it in the app within ${KEEP_DAYS} days.`,
    }),
  );
};

const unclaimed = (now) => ({
  $or: [
    { claimedAt: null },
    { claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
  ],
});

/** Builds one requested file. Safe to call twice: only the caller that claims it does the work. */
const buildExport = async ({ requestId, now = new Date() }) => {
  const row = await FamilyDataExport.findOneAndUpdate(
    {
      requestId,
      status: FamilyDataExportStatus.PREPARING,
      attempts: { $lt: MAX_ATTEMPTS },
      ...unclaimed(now),
    },
    { $set: { claimedAt: now }, $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!row) return;

  const mine = {
    requestId,
    status: FamilyDataExportStatus.PREPARING,
    claimedAt: row.claimedAt,
  };
  try {
    const user = await userOf(row.userId);
    const { buffer } = await buildArchive({ userId: row.userId });
    const key = `data-exports/${randomUUID()}/${randomUUID()}.zip`;
    await uploadAwsService.putObject({
      key,
      body: buffer,
      contentType: "application/zip",
    });

    const preparedAt = new Date();
    const expiresAt = new Date(preparedAt.getTime() + KEEP_DAYS * DAY_MS);
    const saved = await FamilyDataExport.updateOne(mine, {
      $set: {
        status: FamilyDataExportStatus.READY,
        preparedAt,
        expiresAt,
        storageKey: key,
        fileName: fileNameFor(user.name),
        size: buffer.length,
        claimedAt: null,
      },
    });
    if (!saved.modifiedCount) return removeFile(key);
    await announce({ row, user, expiresAt });
  } catch (error) {
    console.error("family data export failed", error.message);
    await FamilyDataExport.updateOne(mine, {
      $set: {
        claimedAt: null,
        ...(row.attempts >= MAX_ATTEMPTS
          ? { status: FamilyDataExportStatus.FAILED }
          : {}),
      },
    });
  }
};

/** Starts a new copy, replacing any earlier file. One request at a time. */
const requestExport = async ({ userId, now = new Date() }) => {
  const requestId = new mongoose.Types.ObjectId();
  let previous;
  try {
    // a request already being prepared does not match, so the upsert hits the unique index
    previous = await FamilyDataExport.findOneAndUpdate(
      { userId, status: { $ne: FamilyDataExportStatus.PREPARING } },
      {
        $set: {
          requestId,
          status: FamilyDataExportStatus.PREPARING,
          requestedAt: now,
          preparedAt: null,
          expiresAt: null,
          storageKey: "",
          fileName: "",
          size: 0,
          claimedAt: null,
          attempts: 0,
        },
      },
      { upsert: true, new: false },
    ).lean();
  } catch (error) {
    if (error.code === 11000) throw new AppError("data_request_pending", 409);
    throw error;
  }

  await removeFile(previous?.storageKey);
  // the file is built after the reply; the scheduled job picks it up if this server stops first
  setImmediate(() => {
    buildExport({ requestId }).catch((error) =>
      console.error("family data export failed", error.message),
    );
  });
  return getState({ userId, now });
};

const sign = (payload) => {
  if (!process.env.JWT_SECRET)
    throw new Error("JWT_SECRET is required for signed download links");
  // the prefix keeps this signature from being accepted anywhere else the secret is used
  return createHmac("sha256", process.env.JWT_SECRET)
    .update(`family-data-export.${payload}`)
    .digest("base64url");
};

const readToken = (token, now) => {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return data.e > now.getTime() ? data : null;
};

/** Checks the password, then gives a link to the file that works for a few minutes. */
const createDownloadLink = async ({
  userId,
  password,
  baseUrl,
  now = new Date(),
}) => {
  const [user, row] = await Promise.all([
    userOf(userId),
    FamilyDataExport.findOne({ userId }).lean(),
  ]);
  if (!isReady(row, now)) throw new AppError("data_export_not_ready", 404);

  // an account that only signs in with Google or Apple has no password to ask for
  if (user.password) {
    if (typeof password !== "string" || !password)
      throw new AppError("data_export_password_required", 400);
    if (!(await bcrypt.compare(password, user.password)))
      throw new AppError("data_export_wrong_password", 403);
  }

  const expiresAt = new Date(
    Math.min(now.getTime() + LINK_MS, row.expiresAt.getTime()),
  );
  const payload = Buffer.from(
    JSON.stringify({
      u: String(userId),
      r: String(row.requestId),
      e: expiresAt.getTime(),
    }),
  ).toString("base64url");

  return {
    url: `${baseUrl}/api/v1/app/family/data-request/file/${payload}.${sign(payload)}`,
    expiresAt,
    fileName: row.fileName,
    fileSize: row.size,
  };
};

/** The file behind a download link; a replaced or expired copy is gone even if the link is not. */
const openFile = async ({ token, now = new Date() }) => {
  const data = readToken(token, now);
  const row = data
    ? await FamilyDataExport.findOne({
        userId: data.u,
        requestId: data.r,
        status: FamilyDataExportStatus.READY,
        expiresAt: { $gt: now },
      }).lean()
    : null;
  if (!row) throw new AppError("data_export_link_expired", 410);

  return {
    stream: await uploadAwsService.getObjectStream(row.storageKey),
    fileName: row.fileName,
    size: row.size,
  };
};

/** Finishes requests left behind by a server that stopped, and gives up after a few tries. */
const processPendingExports = async ({ now = new Date() } = {}) => {
  const rows = await FamilyDataExport.find({
    status: FamilyDataExportStatus.PREPARING,
    ...unclaimed(now),
  })
    .sort({ requestedAt: 1 })
    .limit(BATCH)
    .lean();

  for (const row of rows) {
    if (row.attempts >= MAX_ATTEMPTS) {
      await FamilyDataExport.updateOne(
        { requestId: row.requestId, status: FamilyDataExportStatus.PREPARING },
        { $set: { status: FamilyDataExportStatus.FAILED, claimedAt: null } },
      );
    } else {
      await buildExport({ requestId: row.requestId, now });
    }
  }
};

/** Deletes files past their expiry. A file that cannot be deleted is kept on record and tried again. */
const removeExpiredExports = async ({ now = new Date() } = {}) => {
  const rows = await FamilyDataExport.find({
    status: FamilyDataExportStatus.READY,
    expiresAt: { $lte: now },
  })
    .limit(100)
    .lean();

  for (const row of rows) {
    try {
      if (row.storageKey) await uploadAwsService.deleteFiles(row.storageKey);
      await FamilyDataExport.deleteOne({
        _id: row._id,
        requestId: row.requestId,
      });
    } catch (error) {
      console.error("family data export cleanup failed", error.message);
    }
  }
};

module.exports = {
  getState,
  requestExport,
  buildExport,
  createDownloadLink,
  openFile,
  processPendingExports,
  removeExpiredExports,
};
