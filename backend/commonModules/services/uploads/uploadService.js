const fs = require("fs").promises;
const path = require("path");

const uploadsDirectory = path.resolve(__dirname, "../../../../uploads");

const getSafeFilePath = (filename) => {
  const safeFilename = path.basename(filename || "");
  if (!safeFilename || safeFilename !== filename) {
    const error = new Error("Invalid filename");
    error.statusCode = 400;
    throw error;
  }

  return path.join(uploadsDirectory, safeFilename);
};

const buildUploadedFileResponse = (file) => {
  if (!file) {
    const error = new Error("No file was uploaded");
    error.statusCode = 400;
    throw error;
  }

  return {
    filename: file.filename,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    path: file.path,
  };
};

const getFilePath = async (filename) => {
  const filePath = getSafeFilePath(filename);
  await fs.access(filePath);
  return filePath;
};

const getFileDetails = async ({ filename, protocol, host }) => {
  const filePath = await getFilePath(filename);
  const stats = await fs.stat(filePath);

  return {
    filename,
    size: stats.size,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
    url: `${protocol}://${host}/upload/${encodeURIComponent(filename)}`,
  };
};

const getAllFiles = async ({ protocol, host }) => {
  const filenames = await fs.readdir(uploadsDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of filenames) {
    if (!entry.isFile()) continue;
    files.push(await getFileDetails({
      filename: entry.name,
      protocol,
      host,
    }));
  }

  return files;
};

module.exports = {
  buildUploadedFileResponse,
  getFilePath,
  getFileDetails,
  getAllFiles,
};
