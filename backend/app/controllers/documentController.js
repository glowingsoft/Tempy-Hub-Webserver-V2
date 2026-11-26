const { isValidObjectId } = require("mongoose");
const { sendResponse, validateParams, parsePaginationParams } = require("@utils/responseUtil");
const { respond } = require("@utils/controllerResponse");
const staffDocumentsService = require("../services/staff/staffDocumentsService");
const documentService = require("@adminServices/documents/documentService");
const documentScreenService = require("@adminServices/documents/documentScreenService");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const { AppError } = require("@services/_errors/AppError");

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

const listLibrary = respond(
  (req) =>
    documentScreenService.getDocumentsScreen({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      ...parsePaginationParams(req),
    }),
  { paged: true },
);

const getSignatureRequest = respond((req) =>
  documentScreenService.getSignatureRequest({
    actor: req.user,
    organizationId: req.orgId,
    documentId: req.params.documentId,
    branchId: req.query.branchId,
  }),
);

const sendForSignature = respond(
  (req) =>
    documentScreenService.sendForSignature({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
      branchId: req.body?.branchId,
      staffIds: req.body?.staffIds,
      signBy: req.body?.signBy,
    }),
  { translationKey: "signature_request_sent" },
);

const deleteDocument = respond(
  async (req) => {
    if (!isValidObjectId(req.params.documentId)) {
      throw new AppError("invalid_document_id", 400);
    }
    return documentService.deleteDocument({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
    });
  },
  { translationKey: "document_deleted_successfully" },
);

const uploadedEntries = async (files) => {
  const stored = await uploadAwsService.uploadFiles(files);
  return stored.map((file) => ({
    file: {
      key: file.key,
      originalName: file.filename,
      mimeType: file.contentType,
      sizeBytes: file.size,
    },
  }));
};

const bulkUpload = respond(
  async (req) =>
    documentService.bulkCreateDocuments({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body?.branchId,
      categoryId: req.body?.categoryId,
      audiences: req.body?.audiences,
      requiresSignature: req.body?.requiresSignature,
      files: req.files?.length
        ? await uploadedEntries(req.files)
        : req.body?.files,
    }),
  { statusCode: 201, translationKey: "documents_uploaded" },
);

const publicBaseUrl = (req) =>
  (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(
    /\/+$/,
    "",
  );

const listVisitorDocuments = respond(
  (req) => {
    const { page, limit, skip } = parsePaginationParams(req);
    return documentService.listVisitorDocuments({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.query.branchId,
      keyword: req.query.keyword,
      page,
      limit,
      skip,
    });
  },
  { paged: true },
);

const createQrCode = respond(
  (req) =>
    documentService.createQrCode({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.body?.documentId,
      link: req.body?.link,
      caption: req.body?.caption,
      baseUrl: publicBaseUrl(req),
    }),
  { translationKey: "qr_code_generated" },
);

const regenerateQrLink = respond(
  (req) =>
    documentService.regenerateQrLink({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
      caption: req.body?.caption,
      baseUrl: publicBaseUrl(req),
    }),
  { translationKey: "qr_link_regenerated" },
);

const revokeQrLink = respond(
  (req) =>
    documentService.revokeQrLink({
      actor: req.user,
      organizationId: req.orgId,
      documentId: req.params.documentId,
    }),
  { translationKey: "qr_link_revoked" },
);

const unavailablePage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link unavailable</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:64px 24px;color:#1f2a44"><h1 style="font-size:22px">This link is no longer available</h1></body></html>`;

const openSharedDocument = async (req, res) => {
  try {
    const url = await documentService.getSharedDocumentUrl({
      token: req.params.token,
    });
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    return res.redirect(302, url);
  } catch (error) {
    res.set("Cache-Control", "no-store");
    return res.status(404).type("html").send(unavailablePage);
  }
};

module.exports = {
  createQrCode,
  regenerateQrLink,
  revokeQrLink,
  listVisitorDocuments,
  openSharedDocument,
  listDocuments,
  getDocument,
  signDocument,
  listLibrary,
  getSignatureRequest,
  sendForSignature,
  deleteDocument,
  bulkUpload,
};
