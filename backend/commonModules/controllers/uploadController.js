const upload = require("../../middlewares/uploadFileMw");
const {
  sendResponse,
  validateParams,
} = require("@utils/responseUtil");
const uploadService = require("@commonServices/uploads/uploadService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const uploadFile = (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "file_upload_1",
        error: err,
      });
    }

    try {
      const data = uploadService.buildUploadedFileResponse(req.file);
      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "file_uploaded",
        data,
      });
    } catch (error) {
      return handleServiceError(res, error, "file_upload_1");
    }
  });
};

const getFileByName = async (req, res) => {
  const validationOptions = {
    pathParams: ["filename"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const filePath = await uploadService.getFilePath(req.params.filename);
    return res.sendFile(filePath);
  } catch (error) {
    return handleServiceError(res, error, "file_not");
  }
};

const getFileDetails = async (req, res) => {
  const validationOptions = {
    pathParams: ["filename"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await uploadService.getFileDetails({
      filename: req.params.filename,
      protocol: req.protocol,
      host: req.get("host"),
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "file_details",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "file_not");
  }
};

const getAllFiles = async (req, res) => {
  try {
    const data = await uploadService.getAllFiles({
      protocol: req.protocol,
      host: req.get("host"),
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "all_files",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "unable_to");
  }
};

module.exports = {
  uploadFile,
  getFileByName,
  getFileDetails,
  getAllFiles,
};
