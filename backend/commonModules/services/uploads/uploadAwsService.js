const path = require("path");
const { randomUUID } = require("crypto");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const getBucket = () => process.env.S3_BUCKET_NAME;

const getClient = () => new S3Client({
  region: process.env.AWS_S3_REGION,
  credentials: process.env.AWS_S3_ACCESS_KEY_ID && process.env.AWS_S3_SECRET_ACCESS_KEY
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

  return Promise.all(files.map(async (file) => {
    const key = `${randomUUID()}${path.extname(file.originalname)}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));

    return {
      key,
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      url: `https://${bucket}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${encodeURIComponent(key)}`,
    };
  }));
};

const publicUrl = (key) =>
  `https://${getBucket()}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${encodeURIComponent(key)}`;

const putObject = async ({ key, body, contentType }) => {
  await getClient().send(
    new PutObjectCommand({ Bucket: requireBucket(), Key: key, Body: body, ContentType: contentType })
  );
  return { key, url: publicUrl(key) };
};

const getObject = async (key) => {
  const { Body } = await getClient().send(
    new GetObjectCommand({ Bucket: requireBucket(), Key: key })
  );
  return Buffer.from(await Body.transformToByteArray());
};

const SIGNED_URL_SECONDS = 300;

// A link S3 itself stops honouring after a few minutes, so access lasts no longer than the check that issued it.
const signedPdfUrl = async ({ key, filename, attachment = true, expiresIn = SIGNED_URL_SECONDS }) => {
  const url = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: requireBucket(),
      Key: key,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: `${attachment ? "attachment" : "inline"}; filename="${filename}"`,
    }),
    { expiresIn }
  );
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
};

const deleteFiles = async (fileKey) => {
  await getClient().send(new DeleteObjectCommand({
    Bucket: requireBucket(),
    Key: fileKey,
  }));

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
  signedPdfUrl,
};
