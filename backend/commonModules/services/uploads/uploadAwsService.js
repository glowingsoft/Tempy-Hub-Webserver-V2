const path = require("path");
const { createHmac, randomUUID, timingSafeEqual } = require("crypto");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const getBucket = () => process.env.S3_BUCKET_NAME;

const getClient = () =>
  new S3Client({
    region: process.env.AWS_S3_REGION,
    credentials:
      process.env.AWS_S3_ACCESS_KEY_ID && process.env.AWS_S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

const requireBucket = () => {
  const bucket = getBucket();
  console.log("bucket", bucket);
  if (!bucket) throw new Error("AWS S3 bucket is not configured");
  return bucket;
};

const uploadFiles = async (files) => {
  const bucket = requireBucket();
  console.log("bucket", bucket);
  const client = getClient();
  console.log("client", client);

  return Promise.all(
    files.map(async (file) => {
      const key = `${randomUUID()}${path.extname(file.originalname)}`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      return {
        key,
        filename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
        url: `https://${bucket}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${encodeURIComponent(key)}`,
      };
    }),
  );
};

const publicUrl = (key) =>
  `https://${getBucket()}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${encodeURIComponent(key)}`;

const putObject = async ({ key, body, contentType }) => {
  await getClient().send(
    new PutObjectCommand({
      Bucket: requireBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { key, url: publicUrl(key) };
};

const getObject = async (key) => {
  const { Body } = await getClient().send(
    new GetObjectCommand({ Bucket: requireBucket(), Key: key }),
  );
  return Buffer.from(await Body.transformToByteArray());
};

/** The file as a stream, so a large one is passed on without being held in memory. */
const getObjectStream = async (key) => {
  const { Body } = await getClient().send(
    new GetObjectCommand({ Bucket: requireBucket(), Key: key }),
  );
  return Body;
};

const SIGNED_URL_SECONDS = 300;

// A link S3 itself stops honouring after a few minutes, so access lasts no longer than the check that issued it.
const signedDownloadUrl = async ({
  key,
  filename,
  attachment = true,
  expiresIn = SIGNED_URL_SECONDS,
  contentType = "application/pdf",
}) => {
  const url = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `${attachment ? "attachment" : "inline"}; filename="${filename}"`,
    }),
    { expiresIn },
  );
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
};

const signedPdfUrl = (options) =>
  signedDownloadUrl({ ...options, contentType: options.contentType || "application/pdf" });

const shortLinkSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for signed download links");
  return process.env.JWT_SECRET;
};

const signDownloadPayload = (payload) =>
  createHmac("sha256", shortLinkSecret()).update(payload).digest("base64url");

const createShortDownloadToken = ({
  key,
  filename,
  contentType,
  expiresIn = SIGNED_URL_SECONDS,
}) => {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const payload = Buffer.from(
    JSON.stringify({ k: key, n: filename, t: contentType, e: Math.floor(expiresAt.getTime() / 1000) }),
  ).toString("base64url");
  return { token: `${payload}.${signDownloadPayload(payload)}`, expiresAt };
};

const signedUrlFromShortToken = async (token) => {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) throw new Error("Invalid download link");

  const expected = Buffer.from(signDownloadPayload(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Invalid download link");
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid download link");
  }
  if (
    typeof data.k !== "string" ||
    !data.k.startsWith("compliance-exports/") ||
    !["text/csv; charset=utf-8", "application/pdf"].includes(data.t) ||
    typeof data.n !== "string" ||
    !Number.isInteger(data.e)
  ) {
    throw new Error("Invalid download link");
  }

  const expiresIn = data.e - Math.floor(Date.now() / 1000);
  if (expiresIn <= 0) {
    const error = new Error("Download link expired");
    error.statusCode = 410;
    throw error;
  }
  return signedDownloadUrl({
    key: data.k,
    filename: data.n,
    contentType: data.t,
    expiresIn,
  });
};

/** A file's size and type without downloading it; null when it is not in the bucket. */
const headObject = async (key) => {
  try {
    const found = await getClient().send(
      new HeadObjectCommand({ Bucket: requireBucket(), Key: key }),
    );
    return {
      size: found.ContentLength ?? 0,
      contentType: found.ContentType || "",
    };
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404)
      return null;
    throw error;
  }
};

const deleteFiles = async (fileKey) => {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: requireBucket(),
      Key: fileKey,
    }),
  );

  return {
    translationKey: "file_deleted",
    data: { key: fileKey },
  };
};

module.exports = {
  uploadFiles,
  deleteFiles,
  putObject,
  getObject,
  getObjectStream,
  headObject,
  signedDownloadUrl,
  createShortDownloadToken,
  signedUrlFromShortToken,
  signedPdfUrl,
};
