const {
  sendResponse,
  parsePaginationParams,
} = require("@utils/responseUtil");
const visitorSurveyService = require("@adminServices/visitors/visitorSurveyService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getVisitorSurveySettings = async (req, res) => {
  try {
    const data = await visitorSurveyService.getVisitorSurveySettings({
      actor: req.user,
      organizationId: req.orgId,
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

const saveVisitorSurveySettings = async (req, res) => {
  try {
    const data = await visitorSurveyService.saveVisitorSurveySettings({
      actor: req.user,
      organizationId: req.orgId,
      body: req.body,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "visitor_survey_settings_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listVisitorSurveyQuestions = async (req, res) => {
  try {
    const data = await visitorSurveyService.listVisitorSurveyQuestions({
      actor: req.user,
      organizationId: req.orgId,
      includeInactive: req.query.includeInactive === "true",
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

const saveVisitorSurveyQuestions = async (req, res) => {
  try {
    const data = await visitorSurveyService.saveVisitorSurveyQuestions({
      actor: req.user,
      organizationId: req.orgId,
      questions: req.body.questions,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "visitor_survey_questions_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const createVisitorSurveyResponse = async (req, res) => {
  try {
    const data = await visitorSurveyService.createVisitorSurveyResponse({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      visitSessionId: req.body.visitSessionId,
      externalPersonId: req.body.externalPersonId,
      hostStaffId: req.body.hostStaffId,
      visitorName: req.body.visitorName,
      stayDuration: req.body.stayDuration,
      answers: req.body.answers,
      source: req.body.source,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "visitor_survey_response_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listVisitorSurveyResponses = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await visitorSurveyService.listVisitorSurveyResponses({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      search: req.query.search,
      page,
      limit,
      skip,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getVisitorSurveySettings,
  saveVisitorSurveySettings,
  listVisitorSurveyQuestions,
  saveVisitorSurveyQuestions,
  createVisitorSurveyResponse,
  listVisitorSurveyResponses,
};
