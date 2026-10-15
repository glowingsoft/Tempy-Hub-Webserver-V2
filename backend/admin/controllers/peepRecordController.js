const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const peepRecordService = require("@adminServices/peep/peepRecordService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listPeepRecords = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await peepRecordService.listPeepRecords({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId || req.query.siteId,
      keyword: req.query.keyword || req.query.search,
      peepLevel: req.query.peepLevel,
      floorPlanId: req.query.floorPlanId,
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

const getPeepFloorSummary = async (req, res) => {
  try {
    const data = await peepRecordService.getPeepFloorSummary({
      actor: req.user,
      organizationId: req.orgId,
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

const getPeepRecord = async (req, res) => {
  try {
    const data = await peepRecordService.getPeepRecord({
      actor: req.user,
      organizationId: req.orgId,
      peepRecordId: req.params.peepRecordId,
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

const getPeepRecordByResident = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["residentId"] })) return;

  try {
    const data = await peepRecordService.getPeepRecordByResident({
      actor: req.user,
      organizationId: req.orgId,
      residentId: req.params.residentId,
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

const createPeepRecord = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["residentId", "peepLevel"] })) {
    return;
  }

  try {
    const data = await peepRecordService.createPeepRecord({
      actor: req.user,
      organizationId: req.orgId,
      residentId: req.body.residentId,
      peepLevel: req.body.peepLevel,
      supportNeeds: req.body.supportNeeds,
      primaryRoute: req.body.primaryRoute,
      secondaryRoute: req.body.secondaryRoute,
      equipmentRequired: req.body.equipmentRequired,
      responsibleStaff: req.body.responsibleStaff,
      reviewDueAt: req.body.reviewDueAt,
      consentStatus: req.body.consentStatus,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "peep_record_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updatePeepRecord = async (req, res) => {
  try {
    const data = await peepRecordService.updatePeepRecord({
      actor: req.user,
      organizationId: req.orgId,
      peepRecordId: req.params.peepRecordId,
      peepLevel: req.body.peepLevel,
      supportNeeds: req.body.supportNeeds,
      primaryRoute: req.body.primaryRoute,
      secondaryRoute: req.body.secondaryRoute,
      equipmentRequired: req.body.equipmentRequired,
      responsibleStaff: req.body.responsibleStaff,
      reviewDueAt: req.body.reviewDueAt,
      lastReviewedAt: req.body.lastReviewedAt,
      consentStatus: req.body.consentStatus,
      mcaBestInterestNotes: req.body.mcaBestInterestNotes,
      mobilityNotes: req.body.mobilityNotes,
      assistanceRequired: req.body.assistanceRequired,
      evacuationStrategy: req.body.evacuationStrategy,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "peep_record_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listPeepRecords,
  getPeepFloorSummary,
  getPeepRecord,
  getPeepRecordByResident,
  createPeepRecord,
  updatePeepRecord,
};
