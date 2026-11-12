const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const siteLiveService = require("@adminServices/siteLive/siteLiveService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const getSiteLive = async (req, res) => {
  try {
    const data = await siteLiveService.getSiteLive({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
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

const getSiteLiveActivity = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await siteLiveService.getSiteLiveActivity({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
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

const listPeople = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await siteLiveService.listPeople({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      tab: req.query.tab,
      days: req.query.days,
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

const checkOutPerson = async (req, res) => {
  try {
    const data = await siteLiveService.checkOutPerson({
      actor: req.user,
      organizationId: req.orgId,
      personKind: req.params.personKind,
      recordId: req.params.recordId,
      checkOutAt: req.body?.checkOutAt,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "person_checked_out",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getSiteLive,
  getSiteLiveActivity,
  listPeople,
  checkOutPerson,
};
