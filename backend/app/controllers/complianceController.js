const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const { myCompliance } = require("@adminServices/staff/staffComplianceService");
const teamComplianceService = require("@adminServices/dashboard/teamComplianceService");
const { signedUrlFromShortToken } = require("@commonServices/uploads/uploadAwsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

/** Query filters shared by the Team Compliance list and its export. */
const teamScope = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  branchId: req.query.branchId,
  jobTitleId: req.query.jobTitleId,
  staffId: req.query.staffId,
  tab: req.query.tab,
});

const getMyCompliance = async (req, res) => {
  try {
    const data = await myCompliance({
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

const getTeamCompliance = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await teamComplianceService.getTeamCompliance({
      ...teamScope(req),
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

const exportTeamCompliance = async (req, res) => {
  try {
    const { csv, pdf } = await teamComplianceService.exportTeamCompliance(
      teamScope(req),
    );
    const baseUrl = (
      process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");
    const downloadUrl = `${baseUrl}/api/v1/app/compliance/team/download`;
    const link = (file) => ({
      url: `${downloadUrl}/${file.token}`,
      expiresAt: file.expiresAt,
      filename: file.filename,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: { pdf: link(pdf), csv: link(csv) },
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const downloadTeamComplianceExport = async (req, res) => {
  try {
    const { url } = await signedUrlFromShortToken(req.params.token);
    return res.redirect(302, url);
  } catch (error) {
    return res.sendStatus(error.statusCode || 404);
  }
};

module.exports = {
  getMyCompliance,
  getTeamCompliance,
  exportTeamCompliance,
  downloadTeamComplianceExport,
};
