const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const documentService = require("@adminServices/documents/documentService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listDocuments = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await documentService.listDocuments({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
      branchId: req.query.branchId,
      keyword: req.query.keyword,
      category: req.query.category,
      audience: req.query.audience,
      requiresSignature: req.query.requiresSignature,
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

const createDocument = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["title"] })) return;

  try {
    const data = await documentService.createDocument({
      actor: req.user,
      organizationId: req.orgId,
      title: req.body.title,
      category: req.body.category,
      audiences: req.body.audiences,
      branchId: req.body.branchId,
      requiresSignature: req.body.requiresSignature,
      file: req.body.file,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "document_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const getDocument = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["documentId"] })) return;

  try {
    const data = await documentService.getDocument({
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

const updateDocument = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["documentId"] })) return;

  try {
    const data = await documentService.updateDocument({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
      title: req.body.title,
      category: req.body.category,
      audiences: req.body.audiences,
      branchId: req.body.branchId,
      requiresSignature: req.body.requiresSignature,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "document_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const addDocumentVersion = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["documentId"] })) return;

  try {
    const data = await documentService.addDocumentVersion({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
      file: req.body.file,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "document_version_created_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listAcknowledgements = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["documentId"] })) return;

  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await documentService.listDocumentAcknowledgements({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
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

module.exports = {
  listDocuments,
  createDocument,
  getDocument,
  updateDocument,
  addDocumentVersion,
  listAcknowledgements,
};
