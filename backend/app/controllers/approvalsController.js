const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const {
  listSiteApprovals,
} = require("@adminServices/dashboard/approvalsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listApprovals = async (req, res) => {
  try {
    const pagination = parsePaginationParams(req);
    const limit = Math.min(pagination.limit, 50);
    const data = await listSiteApprovals({
      actor: req.user,
      organizationId: req.orgId,
      organization: req.organization,
      isPlatformAdmin: req.isPlatformAdmin,
      branchId: req.query.branchId || req.branchId,
      tab: req.query.tab,
      page: pagination.page,
      limit,
      skip: (pagination.page - 1) * limit,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: data.data,
      meta: data.meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { listApprovals };
