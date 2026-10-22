const multer = require("multer");
const { sendResponse } = require("@utils/responseUtil");

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//i.test(file.mimetype)),
}).single("file");

/** Reads one image from the "file" field; anything else, or a file over 10 MB, is a 400. */
const receivePhoto = (req, res, next) =>
  photoUpload(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: tooLarge ? "photo_too_large" : "invalid_image",
    });
  });

module.exports = { receivePhoto, MAX_PHOTO_BYTES };
