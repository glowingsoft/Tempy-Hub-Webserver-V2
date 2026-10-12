const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const teamLiveService = require("@adminServices/teamLive/teamLiveService");
const teamRotaService = require("@adminServices/teamLive/teamRotaService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getTeamLive = async (req, res) => {
  try {
    const data = await teamLiveService.getTeamLive({
      actor: req.user,
      organizationId: req.orgId,
      period: req.query.period,
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

const getTeamLiveActivity = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await teamLiveService.getTeamLiveActivity({
      actor: req.user,
      organizationId: req.orgId,
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

const getTeamRota = async (req, res) => {
  try {
    const data = await teamRotaService.getTeamRota({
      actor: req.user,
      organizationId: req.orgId,
      date: req.query.date,
      view: req.query.view,
      departmentId: req.query.departmentId,
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

module.exports = { getTeamLive, getTeamLiveActivity, getTeamRota };
