const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const staffService = require("@adminServices/staff/staffService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const createDepartment = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["name"],
      objectIdFields: req.body?.branchId ? ["branchId"] : [],
    })
  ) {
    return;
  }

  try {
    const data = await staffService.createDepartment({
      actor: req.user,
      organizationId: req.orgId,
      name: req.body.name,
      branchId: req.body.branchId,
      sortOrder: req.body.sortOrder,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "department_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listDepartments = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await staffService.listDepartments({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      branchId: req.query.branchId,
      active: req.query.active,
      status: req.query.status,
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

const getDepartment = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["departmentId"] })) return;

  try {
    const data = await staffService.getDepartment({
      departmentId: req.params.departmentId,
      organizationId: req.orgId,
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

const updateDepartment = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["departmentId"] })) return;

  try {
    const data = await staffService.updateDepartment({
      actor: req.user,
      departmentId: req.params.departmentId,
      organizationId: req.orgId,
      name: req.body.name,
      branchId: req.body.branchId,
      sortOrder: req.body.sortOrder,
      active: req.body.active,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "department_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const createJobTitle = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["name"],
      objectIdFields: [
        ...(req.body?.branchId ? ["branchId"] : []),
        ...(req.body?.departmentId ? ["departmentId"] : []),
      ],
    })
  ) {
    return;
  }

  try {
    const data = await staffService.createJobTitle({
      actor: req.user,
      organizationId: req.orgId,
      name: req.body.name,
      branchId: req.body.branchId,
      departmentId: req.body.departmentId,
      level: req.body.level,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "job_title_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listJobTitles = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await staffService.listJobTitles({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      branchId: req.query.branchId,
      departmentId: req.query.departmentId,
      active: req.query.active,
      status: req.query.status,
      level: req.query.level,
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

const getJobTitle = async (req, res) => {
  try {
    const data = await staffService.getJobTitle({
      jobTitleId: req.params.jobTitleId,
      organizationId: req.orgId,
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

const updateJobTitle = async (req, res) => {
  if (
    !validateParams(req, res, {
      objectIdFields: [
        "jobTitleId",
        ...(req.body?.departmentId ? ["departmentId"] : []),
      ],
    })
  ) {
    return;
  }

  try {
    const data = await staffService.updateJobTitle({
      actor: req.user,
      jobTitleId: req.params.jobTitleId,
      organizationId: req.orgId,
      name: req.body.name,
      level: req.body.level,
      branchId: req.body.branchId,
      departmentId: req.body.departmentId,
      active: req.body.active,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "job_title_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const createStaffProfile = async (req, res) => {
  if (
    !validateParams(req, res, {
      formFields: ["userId", "branchId", "jobTitleId", "startDate"],
    })
  ) {
    return;
  }

  try {
    const data = await staffService.createStaffProfile({
      actor: req.user,
      organizationId: req.orgId,
      userId: req.body.userId,
      branchId: req.body.branchId,
      employeeCode: req.body.employeeCode,
      jobTitleId: req.body.jobTitleId,
      departmentIds: req.body.departmentIds,
      reportsToStaffId: req.body.reportsToStaffId,
      startDate: req.body.startDate,
      contractedWeeklyHours: req.body.contractedWeeklyHours,
      phone: req.body.phone,
      photoUrl: req.body.photoUrl,
      bannerUrl: req.body.bannerUrl,
      ward: req.body.ward,
      locationLabel: req.body.locationLabel,
      pin: req.body.pin,
      status: req.body.status,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "staff_profile_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listStaffProfiles = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await staffService.listStaffProfiles({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      branchId: req.query.branchId,
      departmentId: req.query.departmentId,
      jobTitleId: req.query.jobTitleId,
      status: req.query.status,
      role: req.query.role,
      actor: req.user,
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

const listDirectReports = async (req, res) => {
  try {
    const data = await staffService.listDirectReports({
      actor: req.user,
      organizationId: req.orgId,
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

const getStaffProfile = async (req, res) => {
  try {
    const data = await staffService.getStaffProfile({
      staffProfileId: req.params.staffProfileId,
      organizationId: req.orgId,
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

const updateStaffProfile = async (req, res) => {
  try {
    const data = await staffService.updateStaffProfile({
      actor: req.user,
      staffProfileId: req.params.staffProfileId,
      organizationId: req.orgId,
      branchId: req.body.branchId,
      employeeCode: req.body.employeeCode,
      jobTitleId: req.body.jobTitleId,
      departmentIds: req.body.departmentIds,
      reportsToStaffId: req.body.reportsToStaffId,
      startDate: req.body.startDate,
      contractedWeeklyHours: req.body.contractedWeeklyHours,
      phone: req.body.phone,
      photoUrl: req.body.photoUrl,
      bannerUrl: req.body.bannerUrl,
      ward: req.body.ward,
      locationLabel: req.body.locationLabel,
      pin: req.body.pin,
      nfcTagId: req.body.nfcTagId,
      status: req.body.status,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "staff_profile_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  createDepartment,
  listDepartments,
  getDepartment,
  updateDepartment,
  createJobTitle,
  listJobTitles,
  getJobTitle,
  updateJobTitle,
  createStaffProfile,
  listStaffProfiles,
  listDirectReports,
  getStaffProfile,
  updateStaffProfile,
};
