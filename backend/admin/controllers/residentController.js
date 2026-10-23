const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const residentService = require("@adminServices/residents/residentService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createResident = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["name", "roomNumber", "branchId"],
    })
  ) {
    return;
  }

  try {
    const data = await residentService.createResident({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      photoUrl: req.body.photoUrl,
      roomNumber: req.body.roomNumber,
      careLevel: req.body.careLevel,
      admissionStatus: req.body.admissionStatus ?? req.body.status,
      visitorPasscode: req.body.visitorPasscode,
      photographyConsent: req.body.photographyConsent,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "resident_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listResidents = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await residentService.listResidents({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      status: req.query.status,
      keyword: req.query.keyword,
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

const getResident = async (req, res) => {
  try {
    const data = await residentService.getResident({
      actor: req.user,
      organizationId: req.orgId,
      residentId: req.params.residentId,
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

const updateResident = async (req, res) => {
  try {
    const data = await residentService.updateResident({
      actor: req.user,
      organizationId: req.orgId,
      residentId: req.params.residentId,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      photoUrl: req.body.photoUrl,
      roomNumber: req.body.roomNumber,
      careLevel: req.body.careLevel,
      admissionStatus: req.body.admissionStatus ?? req.body.status,
      branchId: req.body.branchId,
      photographyConsent: req.body.photographyConsent,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "resident_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const setVisitorPasscode = async (req, res) => {
  try {
    const data = await residentService.setVisitorPasscode({
      actor: req.user,
      organizationId: req.orgId,
      residentId: req.params.residentId,
      visitorPasscode: req.body.visitorPasscode,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "resident_passcode_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const verifyVisitorPasscode = async (req, res) => {
  try {
    const data = await residentService.verifyVisitorPasscode({
      actor: req.user,
      organizationId: req.orgId,
      residentId: req.params.residentId,
      visitorPasscode: req.body.visitorPasscode,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "resident_passcode_verified_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  createResident,
  listResidents,
  getResident,
  updateResident,
  setVisitorPasscode,
  verifyVisitorPasscode,
};
