const {
  sendResponse,
  parsePaginationParams,
  validateParams,
} = require("@utils/responseUtil");
const languageService = require("@commonServices/language/languageService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createLanguage = async (req, res) => {
  const validationOptions = {
    rawData: ["title", "transliteration", "code"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { title, transliteration, flag, code } = req.body;

  try {
    const data = await languageService.createLanguage({
      title,
      transliteration,
      flag,
      code,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "language_created_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const getLanguages = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);

  try {
    const { data, meta } = await languageService.getLanguages({ page, limit });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "languages_fetched_success",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const updateLanguage = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    objectIdFields: ["id"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { title, transliteration, flag, code, active } = req.body;

  try {
    const data = await languageService.updateLanguage({
      id: req.params.id,
      title,
      transliteration,
      flag,
      code,
      active,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "language_updated_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const deleteLanguage = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    objectIdFields: ["id"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await languageService.deleteLanguage({ id: req.params.id });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "language_deleted_success",
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const updateUserLanguage = async (req, res) => {
  try {
    const data = await languageService.updateUserLanguage({
      userId: req.user._id,
      languageId: req.body.languageId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_language_updated_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

module.exports = {
  createLanguage,
  getLanguages,
  updateLanguage,
  deleteLanguage,
  updateUserLanguage,
};
