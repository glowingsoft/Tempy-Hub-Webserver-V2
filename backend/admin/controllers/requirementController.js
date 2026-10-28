const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const requirementService = require("@adminServices/requirements/requirementService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listRequirements = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await requirementService.listRequirements({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      type: req.query.type,
      keyword: req.query.keyword || req.query.search,
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

const getRequirement = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["requirementId"] })) return;
  try {
    const data = await requirementService.getRequirement({
      actor: req.user,
      organizationId: req.orgId,
      requirementId: req.params.requirementId,
      branchId: req.query.branchId,
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

const createRequirement = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["name", "type"] })) return;
  try {
    const data = await requirementService.createRequirement({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      name: req.body.name,
      type: req.body.type,
      renewalMonths: req.body.renewalMonths,
      firstCompletionDays: req.body.firstCompletionDays,
      amberDaysOverride: req.body.amberDaysOverride,
      evidenceRequired: req.body.evidenceRequired,
      staffEvidenceAllowed: req.body.staffEvidenceAllowed,
      appliesTo: req.body.appliesTo,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "requirement_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updateRequirement = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["requirementId"] })) return;
  try {
    const data = await requirementService.updateRequirement({
      actor: req.user,
      organizationId: req.orgId,
      requirementId: req.params.requirementId,
      name: req.body.name,
      renewalMonths: req.body.renewalMonths,
      firstCompletionDays: req.body.firstCompletionDays,
      amberDaysOverride: req.body.amberDaysOverride,
      evidenceRequired: req.body.evidenceRequired,
      staffEvidenceAllowed: req.body.staffEvidenceAllowed,
      appliesTo: req.body.appliesTo,
      branchId: req.body.branchId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "requirement_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listAssignments = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await requirementService.listAssignments({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      requirementId: req.query.requirementId,
      type: req.query.type,
      keyword: req.query.keyword || req.query.search,
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

const createAssignments = async (req, res) => {
  try {
    const data = await requirementService.createAssignments({
      actor: req.user,
      organizationId: req.orgId,
      requirementId: req.body.requirementId,
      staffIds: req.body.staffIds,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "assignments_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getAssignment = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["assignmentId"] })) return;
  try {
    const data = await requirementService.getAssignment({
      actor: req.user,
      organizationId: req.orgId,
      assignmentId: req.params.assignmentId,
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

const updateAssignment = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["assignmentId"] })) return;
  try {
    const data = await requirementService.updateAssignment({
      actor: req.user,
      organizationId: req.orgId,
      assignmentId: req.params.assignmentId,
      dueDate: req.body.dueDate,
      renewalMonthsOverride: req.body.renewalMonthsOverride,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "assignment_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const deleteAssignment = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["assignmentId"] })) return;
  try {
    const data = await requirementService.deleteAssignment({
      actor: req.user,
      organizationId: req.orgId,
      assignmentId: req.params.assignmentId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "assignment_deleted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const createRecord = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["assignmentId"] })) return;
  try {
    const data = await requirementService.createRecord({
      actor: req.user,
      organizationId: req.orgId,
      assignmentId: req.params.assignmentId,
      completedAt: req.body.completedAt,
      notes: req.body.notes,
      documents: req.body.documents,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "requirement_record_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const competencyMatrix = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, columns, meta } = await requirementService.competencyMatrix({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      jobTitleId: req.query.jobTitleId,
      departmentId: req.query.departmentId,
      keyword: req.query.keyword || req.query.search,
      page,
      limit,
      skip,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { columns, rows: data },
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listTrainingRecords = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await requirementService.listTrainingRecords({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      staffId: req.query.staffId,
      requirementId: req.query.requirementId,
      type: req.query.type,
      status: req.query.status,
      keyword: req.query.keyword || req.query.search,
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
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  listAssignments,
  createAssignments,
  getAssignment,
  updateAssignment,
  deleteAssignment,
  createRecord,
  competencyMatrix,
  listTrainingRecords,
};
