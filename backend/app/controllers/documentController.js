const { sendResponse, validateParams, parsePaginationParams } = require("@utils/responseUtil");
const staffDocumentsService = require("../services/staff/staffDocumentsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listDocuments = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await staffDocumentsService.listStaffDocuments({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      signed: req.query.signed,
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

const getDocument = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["documentId"] })) return;
  try {
    const data = await staffDocumentsService.getStaffDocument({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
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

const signDocument = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["documentId"] })) return;
  try {
    const data = await staffDocumentsService.signStaffDocument({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
      signatureUrl: req.body?.signatureUrl,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "",
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "document_signed_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { listDocuments, getDocument, signDocument };
