const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const organizationService = require("@adminServices/organizations/organizationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createOrganization = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["name", "ownerEmail"] })) return;

  try {
    const data = await organizationService.createOrganization({
      actor: req.user,
      name: req.body.name,
      owner: { email: req.body.ownerEmail, name: req.body.ownerName },
      settings: req.body.settings,
      moduleAccess: req.body.moduleAccess,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "organization_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listOrganizations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await organizationService.listOrganizations({
      actor: req.user,
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

const getOrganization = async (req, res) => {
  try {
    const data = await organizationService.getOrganization(req.orgId);
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

const updateOrganization = async (req, res) => {
  try {
    const data = await organizationService.updateOrganization({
      organizationId: req.orgId,
      name: req.body.name,
      settings: req.body.settings,
      status: req.body.status,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "organization_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getModuleAccess = async (req, res) => {
  try {
    const data = await organizationService.getModuleAccess(req.orgId);
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

const setModuleAccess = async (req, res) => {
  try {
    const data = await organizationService.setModuleAccess({
      actor: req.user,
      organizationId: req.orgId,
      moduleAccess: req.body.moduleAccess,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "module_access_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listModuleDefinitions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await organizationService.listModuleDefinitions({
      page,
      limit,
      skip,
      includeInactive: req.query.includeInactive === "true",
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
  createOrganization,
  listOrganizations,
  getOrganization,
  updateOrganization,
  getModuleAccess,
  setModuleAccess,
  listModuleDefinitions,
};
