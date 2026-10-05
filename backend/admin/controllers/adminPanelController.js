const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const adminPanelService = require("@adminServices/adminPanel/adminPanelService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const dashboard = async (req, res) => {
  try {
    const data = await adminPanelService.getDashboard();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getUserStatsByRegion = async (req, res) => {
  const validationOptions = {
    dateFields: {
      year: "YYYY",
    },
  };
  if (!validateParams(req, res, validationOptions)) return;

  const year = req.query.year
    ? parseInt(req.query.year, 10)
    : new Date().getFullYear();

  try {
    const data = await adminPanelService.getUserStatsByRegion({ year });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "User stats fetched successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, error.message);
  }
};

const topRatedUsers = async (req, res) => {
  try {
    const data = await adminPanelService.getTopRatedUsers();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Top rated users fetched successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, error.message);
  }
};

const allUsers = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await adminPanelService.listUsers({
      page,
      limit,
      skip,
      status: req.query.status,
      keyword: req.query.keyword,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Users fetched successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const getSupportRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await adminPanelService.getSupportRequests({
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      status: req.query.status,
      applyLimit: req.query.limit != null,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "support_requests",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const updateSupportRequestStatus = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    rawData: ["status"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await adminPanelService.updateSupportRequestStatus({
      id: req.params.id,
      status: req.body.status,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "support_request_2",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const deleteSupportRequest = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await adminPanelService.deleteSupportRequest({ id: req.params.id });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "support_request_3",
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const getContactRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await adminPanelService.getContactRequests({
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      status: req.query.status,
      applyLimit: req.query.limit != null,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "contact_requests",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const updateContactRequestStatus = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    rawData: ["status"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await adminPanelService.updateContactRequestStatus({
      id: req.params.id,
      status: req.body.status,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "contact_request_2",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const deleteContactRequest = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    objectIdFields: ["id"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await adminPanelService.deleteContactRequest({ id: req.params.id });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "contact_request_3",
    });
  } catch (error) {
    return handleServiceError(res, error, "internal_server");
  }
};

const getFaqs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await adminPanelService.getFaqs({
      page,
      limit,
      skip,
      keyword: req.query.keyword,
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

const createFaq = async (req, res) => {
  const validationOptions = {
    rawData: ["question", "answer"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await adminPanelService.createFaq({
      question: req.body.question,
      answer: req.body.answer,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "Faq created successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const updateFaq = async (req, res) => {
  const validationOptions = {
    rawData: ["question", "answer"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await adminPanelService.updateFaq({
      id: req.params.id,
      question: req.body.question,
      answer: req.body.answer,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Faq updated successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const deleteFaq = async (req, res) => {
  const validationOptions = {
    pathParams: ["id"],
    objectIdFields: ["id"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await adminPanelService.deleteFaq({ id: req.params.id });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "Faq deleted successfully",
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const updateUserAccountState = async (req, res) => {
  const validationOptions = {
    pathParams: ["userId"],
    objectIdFields: ["userId"],
    rawData: ["status"],
    enumFields: {
      status: [
        "active",
        "inactive",
        "suspended",
        "softDeleted",
        "hardDeleted",
        "restricted",
      ],
    },
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await adminPanelService.updateUserAccountState({
      userId: req.params.userId,
      status: req.body.status,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_account_state_updated",
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

module.exports = {
  dashboard,
  getUserStatsByRegion,
  topRatedUsers,
  allUsers,
  getSupportRequests,
  updateSupportRequestStatus,
  deleteSupportRequest,
  getContactRequests,
  updateContactRequestStatus,
  deleteContactRequest,
  getFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  updateUserAccountState,
};
