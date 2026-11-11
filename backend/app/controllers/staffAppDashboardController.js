const { sendResponse } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { getStaffAppDashboard } = require("@appServices/staff/staffAppDashboardService");

const getDashboard = async (req, res) => {
  try {
    const data = await getStaffAppDashboard({
      actor: req.user,
      organizationId: req.orgId,
      weekStart: req.query.weekStart,
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

module.exports = { getDashboard };
