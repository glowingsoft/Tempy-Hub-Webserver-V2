const {
  sendResponse,
  validateParams,
} = require("@utils/responseUtil");
const userService = require("@commonServices/users/userService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const blockUser = async (req, res) => {
  const validationOptions = {
    pathParams: ["userIdToBlock"],
    objectIdFields: ["userIdToBlock"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await userService.blockUser({
      currentUserId: req.user._id,
      userIdToBlock: req.params.userIdToBlock,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_blocked",
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_9");
  }
};

const reportUser = async (req, res) => {
  const validationOptions = {
    pathParams: ["userIdToReport"],
    objectIdFields: ["userIdToReport"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    await userService.reportUser({
      currentUserId: req.user._id,
      userIdToReport: req.params.userIdToReport,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_reported",
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_10");
  }
};

const addOrUpdateSubscription = async (req, res) => {
  try {
    const data = await userService.addOrUpdateSubscription({
      userId: req.user._id,
      type: req.body.type,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "subscription_added",
      data,
    });
  } catch (error) {
    return handleServiceError(
      res,
      error,
      "An error occurred while adding or updating the subscription"
    );
  }
};

const removeSubscription = async (req, res) => {
  try {
    await userService.removeSubscription({
      userId: req.user._id,
      subscriptionId: req.params.subscriptionId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "subscription_removed",
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_12");
  }
};

const getSubscriptions = async (req, res) => {
  try {
    const data = await userService.getSubscriptions({ userId: req.user._id });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_subscriptions",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_13");
  }
};

const getUserWithPopulatedFields = async (userId, fieldsToPopulate = []) =>
  userService.getUserWithPopulatedFields(userId, fieldsToPopulate);

const getUserProfile = async (req, res, next, fieldsToPopulate = []) => {
  try {
    const data = await userService.getUserProfile({
      userId: req.user._id,
      fieldsToPopulate,
      organizationId: req.orgId || req.header("x-org-id"),
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_fetched",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_9");
  }
};

const getOtherUserProfile = async (req, res) => {
  try {
    const data = await userService.getOtherUserProfile({
      userId: req.params.userId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_fetched",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_9");
  }
};

const updateUserProfile = async (req, res) => {
  const {
    name,
    profileIcon,
    phoneNumber,
    location,
    distanceUnit,
    currencySymbol,
    currencyCode,
  } = req.body;

  try {
    const data = await userService.updateUserProfile({
      userId: req.user._id,
      name,
      profileIcon,
      phoneNumber,
      location,
      distanceUnit,
      currencySymbol,
      currencyCode,
      allowCurrencyUpdate: false,
      organizationId: req.orgId || req.header("x-org-id"),
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "user_profile",
      data,
    });
  } catch (error) {
    if (error.translationKey === "user_profile_update_error") {
      return handleServiceError(res, error);
    }
    return handleServiceError(res, error, "user_profile_update_error");
  }
};

module.exports = {
  blockUser,
  reportUser,
  addOrUpdateSubscription,
  removeSubscription,
  getSubscriptions,
  getUserWithPopulatedFields,
  getUserProfile,
  updateUserProfile,
  getOtherUserProfile,
};
