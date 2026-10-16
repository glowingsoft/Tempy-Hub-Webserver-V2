const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const kioskService = require("@adminServices/kiosk/kioskService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listKiosks = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await kioskService.listKiosksForAdmin({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      keyword: req.query.keyword,
      setupStatus: req.query.setupStatus,
      kioskMode: req.query.kioskMode,
      presence: req.query.presence,
      deviceType: req.query.deviceType,
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

const getKiosk = async (req, res) => {
  try {
    const data = await kioskService.getKioskForAdmin({
      actor: req.user,
      organizationId: req.orgId,
      kioskId: req.params.kioskId,
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

const createKiosk = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["branchId", "receptionIdentifier"] })) {
    return;
  }
  try {
    const data = await kioskService.createKioskForAdmin({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      receptionIdentifier: req.body.receptionIdentifier,
      locationLabel: req.body.locationLabel,
      deviceType: req.body.deviceType,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "kiosk_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const updateKiosk = async (req, res) => {
  try {
    const data = await kioskService.updateKioskForAdmin({
      actor: req.user,
      organizationId: req.orgId,
      kioskId: req.params.kioskId,
      receptionIdentifier: req.body.receptionIdentifier,
      locationLabel: req.body.locationLabel,
      deviceType: req.body.deviceType,
      branchId: req.body.branchId,
      fireEvacuation: req.body.fireEvacuation,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "kiosk_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const toggleLock = async (req, res) => {
  try {
    const data = await kioskService.toggleKioskLockForAdmin({
      actor: req.user,
      organizationId: req.orgId,
      kioskId: req.params.kioskId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey:
        data.kioskMode === "locked"
          ? "kiosk_locked_successfully"
          : "kiosk_unlocked_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listKiosks,
  getKiosk,
  createKiosk,
  updateKiosk,
  toggleLock,
};
