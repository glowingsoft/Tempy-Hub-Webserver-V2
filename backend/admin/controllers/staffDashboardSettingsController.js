const { sendResponse } = require("@utils/responseUtil");
const staffDashboardSettingsService = require("@adminServices/organizations/staffDashboardSettingsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getStaffDashboardSettings = async (req, res) => {
  try {
    const data = await staffDashboardSettingsService.getStaffDashboardSettings({
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

const saveStaffDashboardSettings = async (req, res) => {
  try {
    const data = await staffDashboardSettingsService.saveStaffDashboardSettings({
      organizationId: req.orgId,
      cards: req.body.cards,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "staff_dashboard_settings_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const resetStaffDashboardSettings = async (req, res) => {
  try {
    const data = await staffDashboardSettingsService.resetStaffDashboardSettings({
      organizationId: req.orgId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "staff_dashboard_settings_updated",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getStaffDashboardSettings,
  saveStaffDashboardSettings,
  resetStaffDashboardSettings,
};
