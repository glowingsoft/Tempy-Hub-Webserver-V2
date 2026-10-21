const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const branchService = require("@adminServices/organizations/branchService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createBranch = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["name", "code"] })) return;

  try {
    const data = await branchService.createBranch({
      actor: req.user,
      organizationId: req.orgId,
      name: req.body.name,
      code: req.body.code,
      address: req.body.address,
      timezone: req.body.timezone,
      assemblyPoint: req.body.assemblyPoint,
      settings: req.body.settings,
      manager: req.body.manager,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "branch_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listBranches = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await branchService.listBranches({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      status: req.query.status,
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

const getBranch = async (req, res) => {
  try {
    const data = await branchService.getBranch({
      branchId: req.params.branchId,
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

const updateBranch = async (req, res) => {
  try {
    const data = await branchService.updateBranch({
      actor: req.user,
      branchId: req.params.branchId,
      organizationId: req.orgId,
      name: req.body.name,
      code: req.body.code,
      address: req.body.address,
      timezone: req.body.timezone,
      assemblyPoint: req.body.assemblyPoint,
      settings: req.body.settings,
      emergencyPin: req.body.emergencyPin,
      status: req.body.status,
      managerUserId: req.body.managerUserId,
      manager: req.body.manager,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "branch_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const issueActivationCode = async (req, res) => {
  try {
    const data = await branchService.issueActivationCode({
      branchId: req.params.branchId,
      organizationId: req.orgId,
      issuedByUserId: req.user._id,
      issuedToUserId: req.body.issuedToUserId,
      expiresInHours: req.body.expiresInHours,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "activation_code_issued_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listActivationCodes = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await branchService.listActivationCodes({
      branchId: req.params.branchId,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      status: req.query.status,
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

const revokeActivationCode = async (req, res) => {
  try {
    const data = await branchService.revokeActivationCode({
      branchId: req.params.branchId,
      organizationId: req.orgId,
      activationCodeId: req.params.activationCodeId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "activation_code_revoked_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  createBranch,
  listBranches,
  getBranch,
  updateBranch,
  issueActivationCode,
  listActivationCodes,
  revokeActivationCode,
};
