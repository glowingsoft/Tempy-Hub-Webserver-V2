const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const siteLiveService = require("@adminServices/siteLive/siteLiveService");
const {
  getSiteStatistics,
  getSiteCompliance,
  exportSiteCompliance,
} = require("@adminServices/dashboard/siteDashboardService");
const { sendPdf } = require("@utils/familyPdfResponse");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { isFamilyModuleActive } = require("@appServices/family/familyAccessService");

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
      format: req.query.format,
    });

    if (result.csv != null) {
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.status(200).send(result.csv);
    }
    return await sendPdf({ req, res, pdf: result.pdf, attachment: true });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  exportCompliance,
  getCompliance,
  getStatistics,
  getSiteLive,
  getSiteLiveActivity,
  listPeople,
  checkOutPerson,
  listDirectory,
};
