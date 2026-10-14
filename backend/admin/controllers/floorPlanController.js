const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const floorPlanService = require("@adminServices/peep/floorPlanService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listFloorPlans = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await floorPlanService.listFloorPlans({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
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

const createFloorPlan = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["name", "branchId"] })) {
    return;
  }

  try {
    const data = await floorPlanService.createFloorPlan({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      name: req.body.name,
      imageUrl: req.body.imageUrl,
      pdfUrl: req.body.pdfUrl,
      meta: req.body.meta,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "floor_plan_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getFloorPlan = async (req, res) => {
  try {
    const data = await floorPlanService.getFloorPlan({
      actor: req.user,
      organizationId: req.orgId,
      floorPlanId: req.params.floorPlanId,
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

const updateFloorPlan = async (req, res) => {
  try {
    const data = await floorPlanService.updateFloorPlan({
      actor: req.user,
      organizationId: req.orgId,
      floorPlanId: req.params.floorPlanId,
      name: req.body.name,
      imageUrl: req.body.imageUrl,
      pdfUrl: req.body.pdfUrl,
      meta: req.body.meta,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "floor_plan_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const upsertFloorPlanPin = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["residentId"] })) {
    return;
  }

  try {
    const data = await floorPlanService.upsertFloorPlanPin({
      actor: req.user,
      organizationId: req.orgId,
      floorPlanId: req.params.floorPlanId,
      residentId: req.body.residentId,
      x: req.body.x,
      y: req.body.y,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "floor_plan_pin_saved_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const deleteFloorPlanPin = async (req, res) => {
  try {
    const data = await floorPlanService.deleteFloorPlanPin({
      actor: req.user,
      organizationId: req.orgId,
      floorPlanId: req.params.floorPlanId,
      pinId: req.params.pinId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "floor_plan_pin_deleted_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listFloorPlans,
  createFloorPlan,
  getFloorPlan,
  updateFloorPlan,
  upsertFloorPlanPin,
  deleteFloorPlanPin,
};
