const {
  sendResponse,
  validateParams,
} = require("@utils/responseUtil");
const communicationService = require("@commonServices/communication/communicationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const sendEmailSgrid = async (req, res) => {
  const validationOptions = {
    rawData: ["title", "emails", "subject", "body"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { title, emails, subject, body, config } = req.body;

  try {
    await communicationService.sendEmailSgrid({
      title,
      emails,
      subject,
      body,
      config,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "email_sent",
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const sendEmailAws = async (req, res) => {
  const validationOptions = {
    rawData: ["title", "emails", "subject", "body"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { emails, subject, body, config } = req.body;

  try {
    await communicationService.sendEmailAws({
      emails,
      subject,
      body,
      config,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "email_sent",
    });
  } catch (error) {
    return handleServiceError(res, error, "failed_to");
  }
};

const sendEmailBrevo = async (req, res) => {
  const validationOptions = {
    rawData: ["title", "emails", "subject", "body"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { emails, subject, body, config } = req.body;

  try {
    await communicationService.sendEmailBrevo({
      emails,
      subject,
      body,
      config,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "email_sent",
    });
  } catch (error) {
    return handleServiceError(res, error, "failed_to");
  }
};

const sendSmsViaPinpointAws = async (req, res) => {
  const validationOptions = {
    rawData: ["phoneNumber", "otp"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { phoneNumber, otp } = req.body;

  try {
    await communicationService.sendSmsViaPinpointAws({ phoneNumber, otp });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_sent",
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const sendNotificationControllerForTesting = async (req, res) => {
  const validationOptions = {
    rawData: ["recipients", "title", "body"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { recipients, title, body, data } = req.body;

  try {
    const result = await communicationService.sendNotificationForTesting({
      recipients,
      title,
      body,
      data,
    });
    return sendResponse({
      res,
      statusCode: result.statusCode,
      translationKey: result.translationKey,
      values: result.values,
      data: result.data,
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
};

const sendSmsViaVonage = async (req, res) => {
  const validationOptions = {
    rawData: ["phoneNumber", "otp"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { phoneNumber, otp } = req.body;

  try {
    const data = await communicationService.sendSmsViaVonage({
      phoneNumber,
      otp,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_sent",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "otp_sent");
  }
};

const sendSMSSomalianAPI = async (req, res) => {
  const validationOptions = {
    rawData: ["phoneNumber", "otp"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { phoneNumber, otp } = req.body;

  try {
    const data = await communicationService.sendSMSSomalianAPI({
      phoneNumber,
      otp,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_sent",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "otp_sent");
  }
};

module.exports = {
  sendEmailSgrid,
  sendEmailAws,
  sendSmsViaPinpointAws,
  sendNotificationControllerForTesting,
  sendSmsViaVonage,
  sendSMSSomalianAPI,
  sendEmailBrevo,
};
