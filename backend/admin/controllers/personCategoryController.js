const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const personCategoryService = require("@adminServices/visitors/personCategoryService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { PersonCategoryAppliesTo } = require("@models/domainEnums");

const listPersonCategories = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await personCategoryService.listPersonCategories({
      actor: req.user,
      organizationId: req.orgId,
      status: req.query.status,
      keyword: req.query.keyword,
      appliesTo: req.query.appliesTo,
      branchId: req.query.branchId,
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

const createPersonCategory = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["name"],
      enumFields: { appliesTo: Object.values(PersonCategoryAppliesTo) },
    })
  ) {
    return;
  }

  try {
    const data = await personCategoryService.createPersonCategory({
      actor: req.user,
      organizationId: req.orgId,
      name: req.body.name,
      appliesTo: req.body.appliesTo,
      branchId: req.body.branchId,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "person_category_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updatePersonCategory = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["categoryId"] })) return;

  try {
    const data = await personCategoryService.updatePersonCategory({
      actor: req.user,
      organizationId: req.orgId,
      categoryId: req.params.categoryId,
      name: req.body.name,
      appliesTo: req.body.appliesTo,
      active: req.body.active,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "person_category_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const deletePersonCategory = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["categoryId"] })) return;

  try {
    const data = await personCategoryService.deletePersonCategory({
      actor: req.user,
      organizationId: req.orgId,
      categoryId: req.params.categoryId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "person_category_deleted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listPersonCategories,
  createPersonCategory,
  updatePersonCategory,
  deletePersonCategory,
};
