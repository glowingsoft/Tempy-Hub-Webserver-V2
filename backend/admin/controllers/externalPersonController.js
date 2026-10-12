const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const externalPersonService = require("@adminServices/visitors/externalPersonService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { ExternalPersonType } = require("@models/domainEnums");

const createExternalPerson = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["branchId", "type", "name" ,"email"],
      enumFields: { type: Object.values(ExternalPersonType) },
    })
  ) {
    return;
  }

  try {
    const data = await externalPersonService.createExternalPerson({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      type: req.body.type,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      photoUrl: req.body.photoUrl,
      carRegistration: req.body.carRegistration,
      departmentId: req.body.departmentId,
      categoryId: req.body.categoryId,
      visitorCategory: req.body.visitorCategory,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "external_person_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listExternalPeople = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await externalPersonService.listExternalPeople({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      departmentId: req.query.departmentId,
      type: req.query.type,
      siteStatus: req.query.siteStatus,
      keyword: req.query.keyword,
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

const getExternalPerson = async (req, res) => {
  try {
    const data = await externalPersonService.getExternalPerson({
      actor: req.user,
      organizationId: req.orgId,
      externalPersonId: req.params.externalPersonId,
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

const updateExternalPerson = async (req, res) => {
  try {
    const data = await externalPersonService.updateExternalPerson({
      actor: req.user,
      organizationId: req.orgId,
      externalPersonId: req.params.externalPersonId,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      photoUrl: req.body.photoUrl,
      carRegistration: req.body.carRegistration,
      departmentId: req.body.departmentId,
      categoryId: req.body.categoryId,
      visitorCategory: req.body.visitorCategory,
      type: req.body.type,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "external_person_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  createExternalPerson,
  listExternalPeople,
  getExternalPerson,
  updateExternalPerson,
};
