const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const shiftService = require("@adminServices/rota/shiftService");
const { ROTA_MANAGE, ROTA_APPROVE } = require("@adminServices/rota/shiftAccess");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { ModuleSlug } = require("@models/domainEnums");

const createShift = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["branchId", "startsAt", "endsAt"] })) {
    return;
  }

  try {
    const data = await shiftService.createShift({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
      staffId: req.body.staffId,
      visibility: req.body.visibility,
      urgentCover: req.body.urgentCover,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "shift_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listShifts = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await shiftService.listShifts({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      status: req.query.status,
      staffId: req.query.staffId,
      from: req.query.from,
      to: req.query.to,
      actor: req.user,
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

const getShift = async (req, res) => {
  try {
    const data = await shiftService.getShift({
      shiftId: req.params.shiftId,
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

const updateShift = async (req, res) => {
  try {
    const data = await shiftService.updateShift({
      actor: req.user,
      shiftId: req.params.shiftId,
      organizationId: req.orgId,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
      staffId: req.body.staffId,
      status: req.body.status,
      visibility: req.body.visibility,
      urgentCover: req.body.urgentCover,
      open: req.body.open,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "shift_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listClaims = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await shiftService.listClaims({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      status: req.query.status,
      shiftId: req.query.shiftId,
      actor: req.user,
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

const getClaim = async (req, res) => {
  try {
    const data = await shiftService.getClaim({
      actor: req.user,
      organizationId: req.orgId,
      claimId: req.params.claimId,
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

const approveClaim = async (req, res) => {
  try {
    const data = await shiftService.approveClaim({
      actor: req.user,
      organizationId: req.orgId,
      claimId: req.params.claimId,
      decisionNote: req.body.decisionNote,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "shift_claim_approved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const rejectClaim = async (req, res) => {
  try {
    const data = await shiftService.rejectClaim({
      actor: req.user,
      organizationId: req.orgId,
      claimId: req.params.claimId,
      decisionNote: req.body.decisionNote,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "shift_claim_rejected",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  createShift,
  listShifts,
  getShift,
  updateShift,
  listClaims,
  getClaim,
  approveClaim,
  rejectClaim,
  ModuleSlug,
  ROTA_MANAGE,
  ROTA_APPROVE,
};
