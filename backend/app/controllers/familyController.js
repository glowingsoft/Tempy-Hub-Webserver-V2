const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const familyAccessService = require("@appServices/family/familyAccessService");
const familyCodeService = require("@appServices/family/familyCodeService");
const familyJoinService = require("@appServices/family/familyJoinService");
const familyMemberService = require("@appServices/family/familyMemberService");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { handleServiceError } = require("@services/_errors/handleServiceError");

/** Who am I viewing? Drives the resident picker and the header dropdown. */
const listMyResidents = async (req, res) => {
  try {
    const data = await familyAccessService.resolveFamilyResidents(req.user._id, {
      activeResidentId: req.query.residentId,
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

/** Options for the Relationship dropdowns. */
const listRelationships = async (req, res) => {
  try {
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: familyAccessService.listRelationships(),
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** Invite Family: the code the next of kin can share. */
const getCurrentFamilyCode = async (req, res) => {
  try {
    const data = await familyCodeService.getCurrentCode({ link: req.familyLink });

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

/** Make A New Code: the old code stops working. */
const createFamilyCode = async (req, res) => {
  try {
    const data = await familyCodeService.createCode({
      link: req.familyLink,
      userId: req.user._id,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "family_code_created",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** Join A Family: the Code Accepted card, after the member types a code. */
const previewJoinCode = async (req, res) => {
  try {
    const data = await familyJoinService.previewCode({
      userId: req.user._id,
      code: req.query.code,
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

/** Join A Family: Send Join Request. */
const requestToJoin = async (req, res) => {
  try {
    const data = await familyJoinService.requestToJoin({
      user: req.user,
      code: req.body.code,
      relationship: req.body.relationship,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "join_request_created",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** Request Sent / Waiting: null when the member has no pending request. */
const getCurrentJoinRequest = async (req, res) => {
  try {
    const data = await familyJoinService.getCurrentRequest(req.user._id);

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

/** Cancel Request, after the confirmation dialog. */
const cancelJoinRequest = async (req, res) => {
  try {
    const data = await familyJoinService.cancelRequest({
      userId: req.user._id,
      requestId: req.params.id,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "join_request_cancelled",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** My Family: members of a resident, with what the caller may do with each. */
const listMembers = async (req, res) => {
  try {
    const data = await familyMemberService.listMembers({
      userId: req.user._id,
      link: req.familyLink,
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

/** My Family: Remove. */
const removeMember = async (req, res) => {
  try {
    const data = await familyMemberService.removeMember({
      userId: req.user._id,
      memberId: req.params.memberId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "family_member_removed",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** My Family: people waiting for review. */
const listJoinRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await familyMemberService.listJoinRequests({
      link: req.familyLink,
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

const decide = (decision, translationKey) => async (req, res) => {
  try {
    const data = await familyMemberService.decideJoinRequest({
      userId: req.user._id,
      requestId: req.params.id,
      decision,
    });

    return sendResponse({ res, statusCode: 200, translationKey, data });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const approveJoinRequest = decide(FamilyMemberStatus.ACTIVE, "join_request_approved");
const rejectJoinRequest = decide(FamilyMemberStatus.REJECTED, "join_request_rejected");

module.exports = {
  listMembers,
  removeMember,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  previewJoinCode,
  requestToJoin,
  getCurrentJoinRequest,
  cancelJoinRequest,
  listMyResidents,
  listRelationships,
  getCurrentFamilyCode,
  createFamilyCode,
};
