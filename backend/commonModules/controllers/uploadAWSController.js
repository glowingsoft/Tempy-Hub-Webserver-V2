const multer = require("multer");
const { sendResponse, validateParams } = require("@utils/responseUtil");
const { uploads3Mw } = require("@middlewares/uploadFilesAWSMw");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const mapMulterError = (res, err) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return sendResponse({
        res,
        statusCode: 413,
        translationKey: "file_upload",
        values: { errorMessage: "Request Entity Too large" },
      });
    }
    if (
      err.code === "LIMIT_FILE_COUNT" ||
      err.code === "LIMIT_UNEXPECTED_FILE"
    ) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "limit_exceeding_max_files",
        error: err.code === "LIMIT_FILE_COUNT" ? "Too many files" : err.message,
      });
    }
    return sendResponse({
      res,
      statusCode: 400,
      translationKey: "file_upload",
      values: {
        errorMessage: err.message,
      },
      error: err,
    });
  }

  return sendResponse({
    res,
    statusCode: 400,
    translationKey: "file_upload",
    values: {
      errorMessage: err.message,
    },
    error: err,
  });
};

const uploadFiles = (req, res) => {
  uploads3Mw(req, res, async (err) => {
    if (err) {
      return mapMulterError(res, err);
    }

    try {
      const data = await uploadAwsService.uploadFiles(req.files);
      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "files_uploaded",
        data,
      });
    } catch (error) {
      return handleServiceError(res, error, "s3_upload");
    }
  });
};

const deleteFiles = async (req, res) => {
  const validationOptions = {
    rawData: ["fileKey"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const result = await uploadAwsService.deleteFiles(req.body.fileKey);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: result.translationKey,
      data: result.data,
    });
  } catch (error) {
    return handleServiceError(res, error, "file_deletion");
  }
};

module.exports = {
  uploadFiles,
  deleteFiles,
};
