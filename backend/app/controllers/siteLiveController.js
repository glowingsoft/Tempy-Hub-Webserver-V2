const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const siteLiveService = require("@adminServices/siteLive/siteLiveService");
const {
  getSiteStatistics,
  getSiteCompliance,
  exportSiteCompliance,
} = require("@adminServices/dashboard/siteDashboardService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { isFamilyModuleActive } = require("@appServices/family/familyAccessService");
const { signedUrlFromShortToken } = require("@commonServices/uploads/uploadAwsService");

const getSiteLive = async (req, res) => {
  try {
    const data = await siteLiveService.getSiteLive({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      familyOn:
        Boolean(req.isPlatformAdmin) || isFamilyModuleActive(req.organization),
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

const listDirectory = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await siteLiveService.listDirectory({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      tab: req.query.tab,
      departmentId: req.query.departmentId,
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
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getStatistics = async (req, res) => {
  try {
    const data = await getSiteStatistics({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      period: req.query.period,
      departmentId: req.query.departmentId,
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

const getCompliance = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await getSiteCompliance({
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

const exportCompliance = async (req, res) => {
  try {
    const result = await exportSiteCompliance({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
    });
    const baseUrl = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(
      /\/+$/,
      "",
    );
    const downloadUrl = `${baseUrl}/api/v1/app/site-live/compliance/download`;

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: {
        pdfUrl: `${downloadUrl}/${result.pdfToken}`,
        pdfFileName: result.pdfFileName,
        pdfExpiresAt: result.pdfExpiresAt,
        csvUrl: `${downloadUrl}/${result.csvToken}`,
        csvFileName: result.csvFileName,
        csvExpiresAt: result.csvExpiresAt,
      },
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const downloadComplianceExport = async (req, res) => {
  try {
    const { url } = await signedUrlFromShortToken(req.params.token);
    return res.redirect(302, url);
  } catch (error) {
    return res.sendStatus(error.statusCode || 404);
  }
};

module.exports = {
  exportCompliance,
  downloadComplianceExport,
  getCompliance,
  getStatistics,
  getSiteLive,
  getSiteLiveActivity,
  listPeople,
  checkOutPerson,
  listDirectory,
};
