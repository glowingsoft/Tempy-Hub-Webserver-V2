const path = require("path");
const { randomUUID } = require("crypto");
const {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

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
};
