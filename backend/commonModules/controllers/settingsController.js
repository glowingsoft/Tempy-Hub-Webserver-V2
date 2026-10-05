const {
  sendResponse,
  parsePaginationParams,
  validateParams,
} = require("@utils/responseUtil");
const settingsService = require("@commonServices/settings/settingsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getTermsAndConditions = async (req, res) => {
  try {
    const data = await settingsService.getTermsAndConditions();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "terms_and_1",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_occurred");
  }
};

const getAboutUs = async (req, res) => {
  try {
    const data = await settingsService.getAboutUs();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "about_us_1",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_occurred");
  }
};

const getPrivacyPolicy = async (req, res) => {
  try {
    const data = await settingsService.getPrivacyPolicy();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "privacy_policy_1",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_occurred");
  }
};

const getFaqs = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const { keyword } = req.query;

  try {
    const { data, meta } = await settingsService.getFaqs({
      page,
      limit,
      keyword,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Faqs fetched successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const createAdminSettings = async (req, res) => {
  const { terms_and_conditions, about_us, privacy_policy, faqs } = req.body;

  try {
    const data = await settingsService.createAdminSettings({
      terms_and_conditions,
      about_us,
      privacy_policy,
      faqs,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "admin_settings_1",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_occurred");
  }
};

const updateAdminSettings = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    objectIdFields: ["id"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await settingsService.updateAdminSettings({
      id: req.params.id,
      body: req.body,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "admin_settings_3",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_occurred");
  }
};

module.exports = {
  getTermsAndConditions,
  getAboutUs,
  getPrivacyPolicy,
  updateAdminSettings,
  createAdminSettings,
  getFaqs,
};
