const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const requirementService = require("@adminServices/requirements/requirementService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { RequirementType } = require("@models/domainEnums");

const listMine = (type) => async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await requirementService.myRequirementAssignments({
      actor: req.user,
      organizationId: req.orgId,
      type,
      status: req.query.status,
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

module.exports = {
  myTraining: listMine(RequirementType.TRAINING),
  myCompetencies: listMine(RequirementType.COMPETENCY),
};
