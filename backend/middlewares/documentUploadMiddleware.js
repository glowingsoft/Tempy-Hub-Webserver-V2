const multer = require("multer");
const { sendResponse } = require("@utils/responseUtil");

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const ALLOWED_NAME = /\.(pdf|docx?|jpe?g|png|webp)$/i;
const ALLOWED_TYPE =
  /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|image\/(jpe?g|png|webp))$/i;

const documentsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter: (req, file, cb) =>
    ALLOWED_NAME.test(file.originalname) && ALLOWED_TYPE.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error("invalid_document_upload")),
}).array("files", MAX_FILES);

const refusal = (res, translationKey) =>
  sendResponse({
    res,
    statusCode: 400,
    translationKey,
    values: { max: MAX_FILES },
  });

const receiveDocuments = (req, res, next) =>
  documentsUpload(req, res, (error) => {
    if (error) {
      const translationKey = {
        LIMIT_FILE_SIZE: "document_too_large",
        LIMIT_FILE_COUNT: "documents_upload_too_large",
      }[error.code];
      return refusal(res, translationKey || "invalid_document_upload");
    }

    const total = (req.files || []).reduce((sum, file) => sum + file.size, 0);
    return total > MAX_TOTAL_BYTES
      ? refusal(res, "documents_upload_too_large")
      : next();
  });

module.exports = { receiveDocuments };
