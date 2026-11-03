const { sendResponse } = require("@utils/responseUtil");
const staffDashboardSettingsService = require("@adminServices/organizations/staffDashboardSettingsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getStaffDashboardSettings = async (req, res) => {
  try {
    const data =
      await staffDashboardSettingsService.getStaffDashboardSettingsForStaff({
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

module.exports = { getStaffDashboardSettings };
