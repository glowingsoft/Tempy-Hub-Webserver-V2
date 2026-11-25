const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const {
  listSiteApprovals,
  getSiteApprovalDetail,
} = require("@adminServices/dashboard/approvalsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { respondByAction } = require("@utils/controllerResponse");
const { FamilyMemberStatus } = require("@models/domainEnums");
const familyStaffService = require("@adminServices/family/familyStaffService");

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

const getApprovalDetail = async (req, res) => {
  try {
    const result = await getSiteApprovalDetail({
      actor: req.user,
      organizationId: req.orgId,
      organization: req.organization,
      isPlatformAdmin: req.isPlatformAdmin,
      type: req.query.type,
      itemId: req.query.itemId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: result,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const decideJoin = (decision, translationKey) => ({
  run: (req) =>
    familyStaffService.decideJoinRequest({
      actor: req.user,
      organizationId: req.orgId,
      requestId: req.params.requestId,
      decision,
    }),
  translationKey,
});

const decideJoinRequest = respondByAction({
  approve: decideJoin(FamilyMemberStatus.ACTIVE, "join_request_approved"),
  reject: decideJoin(FamilyMemberStatus.REJECTED, "join_request_rejected"),
});

module.exports = {
  listApprovals,
  getApprovalDetail,
  decideJoinRequest,
};
