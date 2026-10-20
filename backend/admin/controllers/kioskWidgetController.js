const { sendResponse } = require("@utils/responseUtil");
const kioskWidgetService = require("@adminServices/kiosk/kioskWidgetService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listKioskWidgets = async (req, res) => {
  try {
    const data = await kioskWidgetService.listKioskWidgets({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId || req.query.siteId,
      kioskId: req.query.kioskId,
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

const saveKioskWidgets = async (req, res) => {
  try {
    const data = await kioskWidgetService.saveKioskWidgets({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId || req.query.branchId,
      kioskId: req.body.kioskId,
      homeWidgets: req.body.homeWidgets,
      checkoutWidget: req.body.checkoutWidget,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "kiosk_widgets_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listKioskWidgets,
  saveKioskWidgets,
};
