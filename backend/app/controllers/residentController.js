const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const residentService = require("@adminServices/residents/residentService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const respond = (translationKey, run) => async (req, res) => {
  try {
    const result = await run(req);
    const hasMeta = result && result.data !== undefined && "meta" in result;
    return sendResponse({
      res,
      statusCode: 200,
      translationKey,
      data: hasMeta ? result.data : result,
      meta: hasMeta ? result.meta : undefined,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const scope = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  residentId: req.params.residentId,
});

const listResidents = respond("data_fetched_successfully", (req) =>
  residentService.listManagerResidents({
    actor: req.user,
    organizationId: req.orgId,
    branchId: req.query.branchId,
    tab: req.query.tab,
    admissionStatus: req.query.admissionStatus,
    keyword: req.query.keyword,
    ...parsePaginationParams(req),
  }),
);

const getResident = respond("data_fetched_successfully", (req) =>
  residentService.getManagerResident(scope(req)),
);

const deactivateResident = respond("resident_deactivated", (req) =>
  residentService.deactivateResident({
    ...scope(req),
    reason: req.body.reason,
    message: req.body.message,
  }),
);

module.exports = {
  listResidents,
  getResident,
  deactivateResident,
};
