const {
  sendResponse,
  validateParams,
} = require("@utils/responseUtil");
const contactService = require("@appServices/contact/contactService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createContactRequest = async (req, res) => {
  const validationOptions = {
    rawData: ["name", "email", "description"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { name, email, phoneNumber, description } = req.body;

  try {
    await contactService.createContactRequest({
      name,
      email,
      phoneNumber,
      description,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "contact_request",
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

module.exports = {
  createContactRequest,
};
