const { sendResponse } = require("@utils/responseUtil");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const kioskService = require("@adminServices/kiosk/kioskService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

/** Kiosk Screen 86 — people currently on site before Start Evacuation. */
const getOnSiteSummary = async (req, res) => {
  try {
    const data = await evacuationService.getOnSiteSummary({
      organizationId: req.orgId,
      branchId: req.branchId,
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

/** Figma Screen 79 — site emergency PIN (not kiosk login PIN). */
const verifyEmergencyPin = async (req, res) => {
  try {
    const data = await kioskService.verifyKioskEmergencyPin({
      kiosk: req.kiosk,
      branchId: req.branchId,
      emergencyPin: req.body.emergencyPin || req.body.pin,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "emergency_pin_verified",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** Kiosk Screen 85 type + Screen 86 Start Evacuation. */
const startEvacuation = async (req, res) => {
  try {
    kioskService.assertKioskFireEvacuationEnabled(req.kiosk);
    const data = await evacuationService.startEvacuation({
      organizationId: req.orgId,
      branchId: req.branchId,
      type: req.body.type,
      kioskId: req.kiosk?._id || null,
      startedByUserId: null,
      actor: null,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "evacuation_started",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getActiveEvacuation = async (req, res) => {
  try {
    const data = await evacuationService.getActiveEvacuation({
      organizationId: req.orgId,
      branchId: req.branchId,
      includeStats: true,
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

const closeEvacuation = async (req, res) => {
  try {
    const data = await evacuationService.closeActiveEvacuationForBranch({
      organizationId: req.orgId,
      branchId: req.branchId,
      kioskId: req.kiosk?._id,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "evacuation_closed",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getOnSiteSummary,
  verifyEmergencyPin,
  startEvacuation,
  getActiveEvacuation,
  closeEvacuation,
};
