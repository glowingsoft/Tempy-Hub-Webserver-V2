const { sendResponse, validateParams } = require("@utils/responseUtil");
const authService = require("@commonServices/auth/authService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { AuthAudience } = require("@models/domainEnums");
const { ALL_SURFACES, normalizeSurface } = require("@commonServices/auth/surfaceAccess");

const membershipService = require("@adminServices/organizations/membershipService");
const familyService = require("@adminServices/family/familyService");
const visitorAccountInvitationService = require("@adminServices/visitors/visitorAccountInvitationService");

/**
 * Public but token-gated: an administrator issued the invitation, so this is
 * not the self-registration that stays disabled on every surface.
 */
const previewInvitation = async (req, res) => {
  try {
    const data = await membershipService.previewInvitation(req.params.token);
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

const acceptInvitation = async (req, res) => {
  try {
    const data = await membershipService.acceptInvitation({
      token: req.params.token,
      name: req.body.name,
      password: req.body.password,
      timezone: req.body.timezone,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_accepted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const previewVisitorAccountInvitation = async (req, res) => {
  try {
    const data = await visitorAccountInvitationService.previewVisitorAccountInvitation({
      token: req.params.token,
    });
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

const acceptVisitorAccountInvitation = async (req, res) => {
  try {
    const data = await visitorAccountInvitationService.acceptVisitorAccountInvitation({
      token: req.params.token,
      name: req.body.name,
      password: req.body.password,
      timezone: req.body.timezone,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_accepted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const previewFamilyInvitation = async (req, res) => {
  try {
    const data = await familyService.previewInvitation(req.params.token);
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

const acceptFamilyInvitation = async (req, res) => {
  try {
    const data = await familyService.acceptInvitation({
      token: req.params.token,
      name: req.body.name,
      password: req.body.password,
      timezone: req.body.timezone,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_accepted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const register = async (req, res) => {
  const {
    email,
    phoneNumber,
    deviceId,
    deviceType,
    userType,
    profileIcon,
    name,
    password,
    timezone,
    location,
  } = req.body;

  const validationOptions = {
    rawData: [
      "name",
      "phoneNumber",
      "email",
      "password",
      "deviceId",
      "deviceType",
      "timezone",
    ],
    minLengthFields: {
      password: 6,
    },
  };
  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const data = await authService.register({
      email,
      phoneNumber,
      deviceId,
      deviceType,
      userType,
      profileIcon,
      name,
      password,
      timezone,
      location,
      adminAccessToken: req.header("x-admin-access-token"),
      body: req.body,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "signup_successful",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error");
  }
};

const login = async (req, res) => {
  const { email, password, deviceId, deviceType, timezone } = req.body;
  const audience = req.body.audience || undefined;
  let surface;
  try {
    surface = normalizeSurface(req.body.surface);
  } catch (error) {
    return handleServiceError(res, error);
  }

  const validationOptions = {
    rawData: ["email", "password", "deviceId", "deviceType", "timezone"],
    enumFields: {
      audience: [
        AuthAudience.STAFF,
        AuthAudience.VISITOR,
        AuthAudience.RESIDENT,
        AuthAudience.FAMILY,
      ],
      ...(surface ? { surface: ALL_SURFACES } : {}),
    },
  };
  if (surface) req.body.surface = surface;
  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const data = await authService.login({
      email,
      password,
      deviceId,
      deviceType,
      timezone,
      audience,
      surface,
      adminAccessToken: req.header("x-admin-access-token"),
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "login_success",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const me = async (req, res) => {
  try {
    const data = await authService.me({
      userId: req.user._id,
      audience: req.audience,
      organizationId: req.header("x-org-id") || req.query.organizationId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "profile_fetched",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const generateOtp = async (req, res) => {
  const { email, phoneNumber, type } = req.body;
  const validationOptions = {
    rawData: [type === "email" ? "email" : "phoneNumber"],
  };
  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const data = await authService.generateOtp({ email, phoneNumber, type });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "otp_generated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const verifyOtp = async (req, res) => {
  const { email, phoneNumber, type, otp } = req.body;
  const validationOptions = {
    rawData: [type === "email" ? "email" : "phoneNumber"],
  };
  if (type === "email") {
    validationOptions.rawData.push("otp");
  }
  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const data = await authService.verifyOtp({
      email,
      phoneNumber,
      type,
      otp,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_verified",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error");
  }
};

const changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const validationOptions = {
    rawData: ["oldPassword", "newPassword"],
    minLengthFields: { newPassword: 6 },
  };
  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    await authService.changePassword({
      userId: req.user._id,
      oldPassword,
      newPassword,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "password_changed",
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_1");
  }
};

const resetPassword = async (req, res) => {
  const { email, newPassword, resetToken } = req.body;

  const validationOptions = {
    rawData: ["email", "newPassword", "resetToken"],
  };
  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const data = await authService.resetPassword({
      email,
      newPassword,
      resetToken,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "password_has",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "an_error_1");
  }
};

const logout = async (req, res) => {
  try {
    await authService.logout({
      userId: req.user._id,
      deviceId: req.body.deviceId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "logged_out",
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const deleteAccount = async (req, res) => {
  try {
    await authService.deleteAccount({
      userId: req.user._id,
      email: req.user.email,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "account_deleted",
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const socialAuth = async (req, res) => {
  const { provider, socialId, email, name, deviceId, deviceType, timezone } =
    req.body;

  const validationOptions = {
    rawData: [
      "provider",
      "socialId",
      "email",
      "name",
      "deviceId",
      "deviceType",
      "timezone",
    ],
    enumFields: {
      provider: ["google", "facebook", "apple"],
    },
  };

  if (!validateParams(req, res, validationOptions)) {
    return;
  }

  try {
    const result = await authService.socialAuth({
      provider,
      socialId,
      email,
      name,
      deviceId,
      deviceType,
      timezone,
    });

    return sendResponse({
      res,
      statusCode: result.statusCode,
      translationKey: result.translationKey,
      data: result.data,
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

module.exports = {
  register,
  login,
  me,
  generateOtp,
  verifyOtp,
  resetPassword,
  changePassword,
  logout,
  deleteAccount,
  socialAuth,
  previewInvitation,
  acceptInvitation,
  previewFamilyInvitation,
  acceptFamilyInvitation,
  previewVisitorAccountInvitation,
  acceptVisitorAccountInvitation,
};
