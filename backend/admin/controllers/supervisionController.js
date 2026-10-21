const { sendResponse } = require("@utils/responseUtil");
const supervisionService = require("@adminServices/supervision/supervisionService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const updateSupervisionSettings = async (req, res) => {
  try {
    const data = await supervisionService.updateSupervisionSettings({
      actor: req.user,
      organizationId: req.orgId,
      staffProfileId: req.params.staffProfileId,
      supervisorStaffId: req.body.supervisorStaffId,
      supervisionIntervalMonths: req.body.supervisionIntervalMonths,
      appraisalIntervalMonths: req.body.appraisalIntervalMonths,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "supervision_settings_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listTeamSupervision = async (req, res) => {
  try {
    const data = await supervisionService.listTeamSupervision({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
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

const createSupervision = async (req, res) => {
  try {
    const data = await supervisionService.createSupervision({
      actor: req.user,
      organizationId: req.orgId,
      staffId: req.body.staffId,
      status: req.body.status,
      scheduledAt: req.body.scheduledAt,
      locationLabel: req.body.locationLabel,
      completedAt: req.body.completedAt,
      topics: req.body.topics,
      notes: req.body.notes,
      actionPoints: req.body.actionPoints,
      file: req.body.file,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "supervision_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updateSupervision = async (req, res) => {
  try {
    const data = await supervisionService.updateSupervision({
      actor: req.user,
      organizationId: req.orgId,
      supervisionId: req.params.supervisionId,
      status: req.body.status,
      scheduledAt: req.body.scheduledAt,
      locationLabel: req.body.locationLabel,
      completedAt: req.body.completedAt,
      topics: req.body.topics,
      notes: req.body.notes,
      actionPoints: req.body.actionPoints,
      file: req.body.file,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "supervision_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const signOffActionPoint = async (req, res) => {
  try {
    const data = await supervisionService.signOffActionPoint({
      actor: req.user,
      organizationId: req.orgId,
      supervisionId: req.params.supervisionId,
      actionPointId: req.params.actionPointId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "action_point_signed_off",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  updateSupervisionSettings,
  listTeamSupervision,
  createSupervision,
  updateSupervision,
  signOffActionPoint,
};
