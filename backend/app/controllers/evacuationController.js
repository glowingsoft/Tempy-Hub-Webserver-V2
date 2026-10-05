const { sendResponse } = require("@utils/responseUtil");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { EvacCheckStatus } = require("@models/domainEnums");

/** Staff: active evacuation for a branch (Alerts screens). */
const getActiveEvacuation = async (req, res) => {
  try {
    const data = await evacuationService.getActiveEvacuation({
      organizationId: req.orgId,
      branchId: req.query.branchId,
      includeStats: false,
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

/**
 * Staff self mark — Smoke "I Understand - Waiting" → status unknown + locationLabel,
 * or full evacuate → status safe.
 */
const markMyself = async (req, res) => {
  try {
    const data = await evacuationService.markSelfCheck({
      organizationId: req.orgId,
      userId: req.user._id,
      branchId: req.body.branchId,
      status: req.body.status || EvacCheckStatus.SAFE,
      locationLabel: req.body.locationLabel,
      geo: req.body.geo,
      clientEventId: req.body.clientEventId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "evac_check_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getActiveEvacuation,
  markMyself,
};
