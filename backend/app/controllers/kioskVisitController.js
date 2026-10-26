const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const kioskVisitService = require("@adminServices/kiosk/kioskVisitService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listCategories = async (req, res) => {
  try {
    const data = await kioskVisitService.listVisitCategories({
      organizationId: req.orgId,
      branchId: req.branchId,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const searchPeople = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await kioskVisitService.searchVisitPeople({
      branchId: req.branchId,
      keyword: req.query.keyword,
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
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const listPolicies = async (req, res) => {
  try {
    const data = await kioskVisitService.listVisitPolicies({
      organizationId: req.orgId,
      branchId: req.branchId,
      personType: req.query.personType || req.query.type,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const verifyInvite = async (req, res) => {
  try {
    const data = await kioskVisitService.verifyInvite({
      branchId: req.branchId,
      inviteCode: req.body.inviteCode,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_code_verified_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const resendInvite = async (req, res) => {
  try {
    const data = await kioskVisitService.resendInvite({
      organizationId: req.orgId,
      branchId: req.branchId,
      email: req.body.email,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_sent_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const checkIn = async (req, res) => {
  try {
    const data = await kioskVisitService.checkInAtKiosk({
      organizationId: req.orgId,
      branchId: req.branchId,
      kiosk: req.kiosk,
      method: req.body.method,
      inviteCode: req.body.inviteCode,
      externalPersonId: req.body.externalPersonId,
      type: req.body.type,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      carRegistration: req.body.carRegistration,
      photoUrl: req.body.image || req.body.photoUrl,
      hostStaffId: req.body.hostStaffId,
      hostName: req.body.hostName,
      purposeOfVisit: req.body.purposeOfVisit,
      categoryId: req.body.categoryId,
      signatures: req.body.signatures,
    });
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "visit_checked_in_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const checkOut = async (req, res) => {
  try {
    const data = await kioskVisitService.checkOutAtKiosk({
      branchId: req.branchId,
      kiosk: req.kiosk,
      visitSessionId: req.body.visitSessionId,
      externalPersonId: req.body.externalPersonId,
      inviteCode: req.body.inviteCode,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "visit_checked_out_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const listOnSite = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await kioskVisitService.listOnSiteVisits({
      branchId: req.branchId,
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
    return handleServiceError(res, error, "something_went_wrong");
  }
};

module.exports = {
  listCategories,
  searchPeople,
  listPolicies,
  verifyInvite,
  resendInvite,
  checkIn,
  checkOut,
  listOnSite,
};
