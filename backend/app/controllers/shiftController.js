const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const shiftService = require("@adminServices/rota/shiftService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listMyShifts = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await shiftService.listMyShifts({
      userId: req.user._id,
      organizationId: req.orgId,
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
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

const listOpenShifts = async (req, res) => {
  try {
    const data = await shiftService.listOpenShifts({
      userId: req.user._id,
      organizationId: req.orgId,
      from: req.query.from,
      to: req.query.to,
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

const getActiveShift = async (req, res) => {
  try {
    const data = await shiftService.getActiveShift({
      userId: req.user._id,
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

const createClaim = async (req, res) => {
  try {
    const data = await shiftService.createClaim({
      userId: req.user._id,
      organizationId: req.orgId,
      shiftId: req.params.shiftId,
      note: req.body.note,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "shift_claim_created",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const withdrawClaim = async (req, res) => {
  try {
    const data = await shiftService.withdrawClaim({
      userId: req.user._id,
      organizationId: req.orgId,
      claimId: req.params.claimId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "shift_claim_withdrawn",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listMyShifts,
  listOpenShifts,
  getActiveShift,
  createClaim,
  withdrawClaim,
};
