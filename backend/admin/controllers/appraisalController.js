const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const appraisalService = require("@adminServices/appraisal/appraisalService");
const complianceHistoryService = require("@adminServices/appraisal/complianceHistoryService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const settingsPayload = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  staffProfileId: req.params.staffProfileId,
  supervisorStaffId: req.body.supervisorStaffId,
  supervisionIntervalMonths: req.body.supervisionIntervalMonths,
  appraisalIntervalMonths: req.body.appraisalIntervalMonths,
});

const updateAppraisalSettings = async (req, res) => {
  try {
    const data = await appraisalService.updateStaffComplianceSettings(settingsPayload(req));

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "appraisal_settings_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updateStaffComplianceSettings = async (req, res) => {
  try {
    const data = await appraisalService.updateStaffComplianceSettings(settingsPayload(req));

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "staff_settings_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listComplianceHistory = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await complianceHistoryService.listComplianceHistory({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      type: req.query.type,
      from: req.query.from,
      to: req.query.to,
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

const listTeamAppraisals = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const result = await appraisalService.listTeamAppraisals({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      status: req.query.status,
      keyword: req.query.keyword || req.query.search,
      page,
      limit,
      skip,
      format: req.query.format,
    });

    if (result.csv != null) {
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.status(200).send(result.csv);
    }

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.getAppraisal({
      actor: req.user,
      organizationId: req.orgId,
      appraisalId: req.params.appraisalId,
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

const meetingBody = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  staffId: req.body.staffId,
  kind: req.body.kind,
  status: req.body.status,
  scheduledAt: req.body.scheduledAt,
  periodLabel: req.body.periodLabel,
  completedAt: req.body.completedAt,
  managerComments: req.body.managerComments,
  goals: req.body.goals,
  trainingNeeds: req.body.trainingNeeds,
  actionPoints: req.body.actionPoints,
  file: req.body.file,
});

const createAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.createAppraisal(meetingBody(req));

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "appraisal_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updateAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.updateAppraisal({
      ...meetingBody(req),
      appraisalId: req.params.appraisalId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "appraisal_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const signOffActionPoint = async (req, res) => {
  try {
    const data = await appraisalService.signOffActionPoint({
      actor: req.user,
      organizationId: req.orgId,
      appraisalId: req.params.appraisalId,
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

const signOffActionPoints = async (req, res) => {
  try {
    const data = await appraisalService.signOffActionPoints({
      actor: req.user,
      organizationId: req.orgId,
      appraisalId: req.params.appraisalId,
      actionPointIds: req.body.actionPointIds,
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

const managerSignAppraisal = async (req, res) => {
  try {
    const data = await appraisalService.managerSignAppraisal({
      actor: req.user,
      organizationId: req.orgId,
      appraisalId: req.params.appraisalId,
      signatureUrl: req.body?.signatureUrl,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "appraisal_signed_off",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  updateAppraisalSettings,
  updateStaffComplianceSettings,
  listComplianceHistory,
  listTeamAppraisals,
  getAppraisal,
  createAppraisal,
  updateAppraisal,
  signOffActionPoint,
  signOffActionPoints,
  managerSignAppraisal,
};
