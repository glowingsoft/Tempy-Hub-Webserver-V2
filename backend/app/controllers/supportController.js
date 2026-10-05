const {
  sendResponse,
  validateParams,
} = require("../../helperUtils/responseUtil");
const supportService = require("@appServices/support/supportService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createSupportRequest = async (req, res) => {
  const validationOptions = {
    rawData: ["name", "email", "subject", "message"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { name, email, subject, message } = req.body;

  try {
    await supportService.createSupportRequest({
      name,
      email,
      subject,
      message,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "support_request",
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

module.exports = {
  createSupportRequest,
};
