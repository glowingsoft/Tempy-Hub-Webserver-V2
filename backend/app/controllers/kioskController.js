const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");

const kioskService = require("@adminServices/kiosk/kioskService");

const { handleServiceError } = require("@services/_errors/handleServiceError");



const searchBranches = async (req, res) => {

  try {

    const { page, limit, skip } = parsePaginationParams(req);

    const { data, meta } = await kioskService.searchBranchesForKiosk({

      keyword: req.query.keyword,

      deviceId: req.query.deviceId,

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



const searchStaff = async (req, res) => {

  try {

    const { page, limit, skip } = parsePaginationParams(req);

    const { data, meta } = await kioskService.searchStaffForKiosk({

      organizationId: req.orgId,

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



const getStaffPreview = async (req, res) => {

  try {

    const data = await kioskService.getStaffPreviewForKiosk({

      organizationId: req.orgId,

      branchId: req.branchId,

      staffId: req.params.staffId,

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



const requestCheckInOtp = async (req, res) => {

  try {

    const data = await kioskService.requestKioskCheckInOtp({

      organizationId: req.orgId,

      branchId: req.branchId,

      staffId: req.body.staffId,

    });



    return sendResponse({

      res,

      statusCode: 200,

      translationKey: "kiosk_check_in_otp_sent",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const verifyCheckInOtp = async (req, res) => {

  try {

    const data = await kioskService.verifyKioskCheckInOtp({

      organizationId: req.orgId,

      branchId: req.branchId,

      kioskId: req.kiosk._id,

      staffId: req.body.staffId,

      otp: req.body.otp,

      clientEventId: req.body.clientEventId,

      occurredAt: req.body.occurredAt,

    });



    return sendResponse({

      res,

      statusCode: 201,

      translationKey: "attendance_clock_in_success",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const getQr = async (req, res) => {

  try {

    const data = await kioskService.getKioskQr({ kioskId: req.kiosk._id });



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



const getPendingPairing = async (req, res) => {

  try {

    const data = await kioskService.getPendingPairing({ kioskId: req.kiosk._id });



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



const confirmPairing = async (req, res) => {

  try {

    const data = await kioskService.confirmPairingAndClockIn({

      kioskId: req.kiosk._id,

      organizationId: req.orgId,

      branchId: req.branchId,

      sessionId: req.params.sessionId,

      clientEventId: req.body.clientEventId,

      occurredAt: req.body.occurredAt,

    });



    return sendResponse({

      res,

      statusCode: 201,

      translationKey: "attendance_clock_in_success",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const cancelPairing = async (req, res) => {

  try {

    const data = await kioskService.cancelPairing({

      kioskId: req.kiosk._id,

      sessionId: req.params.sessionId,

    });



    return sendResponse({

      res,

      statusCode: 200,

      translationKey: "kiosk_pairing_cancelled",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const scanFromPhone = async (req, res) => {

  try {

    const data = await kioskService.scanKioskFromPhone({

      scanToken: req.body.scanToken,

      userId: req.user._id,

      organizationId: req.orgId,

    });



    return sendResponse({

      res,

      statusCode: 200,

      translationKey: "kiosk_scan_successful",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const register = async (req, res) => {

  try {

    const data = await kioskService.registerKiosk({

      branchId: req.body.branchId,

      activationCode: req.body.activationCode,

      deviceId: req.body.deviceId,

      adminPin: req.body.adminPin,

      receptionIdentifier: req.body.receptionIdentifier,

      locationLabel: req.body.locationLabel,

      deviceType: req.body.deviceType,

      fireEvacuation: req.body.fireEvacuation,

    });



    return sendResponse({

      res,

      statusCode: 201,

      translationKey: "kiosk_registered_successfully",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};

const verifyAdminPin = async (req, res) => {
  try {
    const data = await kioskService.verifyKioskAdminPin({
      branchId: req.body.branchId,
      deviceId: req.body.deviceId,
      adminPin: req.body.adminPin,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "kiosk_admin_pin_verified",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};

const getMe = async (req, res) => {

  try {

    const data = await kioskService.getKioskSession({

      kiosk: req.kiosk,

      branch: req.branch,

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

const updateMe = async (req, res) => {
  try {
    const data = await kioskService.updateKioskSettings({
      kiosk: req.kiosk,
      branch: req.branch,
      fireEvacuation: req.body.fireEvacuation,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "kiosk_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "something_went_wrong");
  }
};



const staffBody = (body) => ({

  staffId: body.staffId,

  nfcTagId: body.nfcTagId,

  employeeCode: body.employeeCode,

  pin: body.pin,

  clientEventId: body.clientEventId,

  occurredAt: body.occurredAt,

});



const clockIn = async (req, res) => {

  try {

    const data = await kioskService.clockInAtKiosk({

      organizationId: req.orgId,

      branchId: req.branchId,

      kioskId: req.kiosk._id,

      ...staffBody(req.body),

    });



    return sendResponse({

      res,

      statusCode: 201,

      translationKey: "attendance_clock_in_success",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const clockOut = async (req, res) => {

  try {

    const data = await kioskService.clockOutAtKiosk({

      organizationId: req.orgId,

      branchId: req.branchId,

      kioskId: req.kiosk._id,

      ...staffBody(req.body),

    });



    return sendResponse({

      res,

      statusCode: 200,

      translationKey: "attendance_clock_out_success",

      data,

    });

  } catch (error) {

    return handleServiceError(res, error, "something_went_wrong");

  }

};



const listOnSite = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await kioskService.listOnSiteAtKiosk({
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

const getToday = async (req, res) => {

  try {

    const data = await kioskService.getTodayAtKiosk({

      organizationId: req.orgId,

      branchId: req.branchId,

      ...staffBody(req.query),

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



module.exports = {

  searchBranches,

  searchStaff,

  getStaffPreview,

  requestCheckInOtp,

  verifyCheckInOtp,

  getQr,

  getPendingPairing,

  confirmPairing,

  cancelPairing,

  scanFromPhone,

  register,

  verifyAdminPin,

  getMe,

  updateMe,

  clockIn,

  clockOut,

  getToday,

  listOnSite,

};


