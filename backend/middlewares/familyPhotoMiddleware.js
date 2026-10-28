const multer = require("multer");
const { sendResponse } = require("@utils/responseUtil");

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_PHOTOS = 10;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;

const isImage = (req, file, cb) => cb(null, /^image\//i.test(file.mimetype));
const storage = multer.memoryStorage();

const photoUpload = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: isImage,
}).single("file");
const photosUpload = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_BATCH_PHOTOS },
  fileFilter: isImage,
}).array("files", MAX_BATCH_PHOTOS);

const refusal = (res, translationKey) =>
  sendResponse({ res, statusCode: 400, translationKey });

/** One image from the "file" field; anything else, or a file over 10 MB, is a 400. */
const receivePhoto = (req, res, next) =>
  photoUpload(req, res, (error) => {
    if (!error) return next();
    const translationKey = {
      LIMIT_FILE_SIZE: "photo_too_large",
      LIMIT_FILE_COUNT: "one_photo_at_a_time",
      LIMIT_UNEXPECTED_FILE: "one_photo_at_a_time",
    }[error.code];
    return refusal(res, translationKey || "invalid_image");
  });

/** Up to 10 images from the "files" field, 10 MB each and 50 MB together. */
const receivePhotos = (req, res, next) =>
  photosUpload(req, res, (error) => {
    if (error) {
      const translationKey = {
        LIMIT_FILE_SIZE: "photo_too_large",
        LIMIT_FILE_COUNT: "photos_batch_rules",
        LIMIT_UNEXPECTED_FILE: "photos_batch_rules",
      }[error.code];
      return refusal(res, translationKey || "invalid_image");
    }

    const total = (req.files || []).reduce((sum, file) => sum + file.size, 0);
    return total > MAX_BATCH_BYTES
      ? refusal(res, "photos_batch_too_large")
      : next();
  });

module.exports = { receivePhoto, receivePhotos };
