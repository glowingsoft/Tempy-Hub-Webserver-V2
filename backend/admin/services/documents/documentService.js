const crypto = require("crypto");
const mongoose = require("mongoose");
const { DocumentShareLink } = require("@models/DocumentShareLink");
const { Document } = require("@models/Document");
const { DocumentVersion } = require("@models/DocumentVersion");
const { DocumentSignature } = require("@models/DocumentSignature");
const { User } = require("@models/UserModel");
const { StaffProfile } = require("@models/StaffProfile");
const { ExternalPerson } = require("@models/ExternalPerson");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { AppError } = require("@services/_errors/AppError");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const {
  DocumentScope,
  DocumentAudience,
  MembershipRole,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./documentAccess");
const { resolveCategoryId } = require("./documentCategoryService");

const AUDIENCES = new Set(Object.values(DocumentAudience));
const SCOPES = new Set(Object.values(DocumentScope));

const toOid = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError("invalid_id", 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const parseAudiences = (value) => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const unique = [
    ...new Set(list.map((item) => String(item).trim()).filter(Boolean)),
  ];
  if (!unique.length) return [DocumentAudience.STAFF];
  for (const item of unique) {
    if (!AUDIENCES.has(item))
      throw new AppError("invalid_document_audience", 400);
  }
  return unique;
};

const parseStoredFile = (file) => {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new AppError("document_file_required", 400);
  }
  const key = String(file.key || "").trim();
  if (!key) throw new AppError("document_file_required", 400);
  if (/^https?:\/\//i.test(key))
    throw new AppError("document_file_key_invalid", 400);

  const sizeBytes = Number(file.sizeBytes);
  return {
    key,
    originalName: String(file.originalName || "").trim(),
    mimeType: String(file.mimeType || "").trim(),
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
  };
};

const versionFile = (version) => {
  if (!version) return null;
  const raw = version.file || {};
  const key = String(raw.key || version.fileUrl || "").trim();
  if (!key) return null;
  return {
    key,
    originalName: raw.originalName || "",
    mimeType: raw.mimeType || "",
    sizeBytes: raw.sizeBytes || 0,
    url: toPublicImageUrl(key),
  };
};

const shapeDocument = (row) => {
  if (!row) return null;
  const version = row._version || null;
  const file = versionFile(version);
  return {
    _id: row._id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    ownerUserId: row.ownerUserId,
    title: row.title,
    scope: row.scope,
    categoryId: row.categoryId || null,
    category: row._category
      ? {
          _id: row._category._id,
          title: row._category.title,
          active: row._category.active !== false,
        }
      : null,
    audiences: row.audiences?.length ? row.audiences : [DocumentAudience.STAFF],
    requiresSignature: row.requiresSignature !== false,
    currentVersionId: row.currentVersionId,
    version: version
      ? {
          _id: version._id,
          version: version.version,
          createdAt: version.createdAt,
          uploadedBy: version.uploadedBy,
          file,
        }
      : null,
    file,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const versionLookup = [
  {
    $lookup: {
      from: DocumentVersion.collection.name,
      localField: "currentVersionId",
      foreignField: "_id",
      as: "_version",
    },
  },
  { $unwind: { path: "$_version", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "documentcategories",
      localField: "categoryId",
      foreignField: "_id",
      as: "_category",
    },
  },
  { $unwind: { path: "$_category", preserveNullAndEmptyArrays: true } },
];

const visibleMatch = (organizationId, standing, branchId) => {
  const match = { organizationId };
  const scopedBranchId = scopeBranchFilter(standing, branchId);

  if (scopedBranchId) {
    match.$or = [{ branchId: scopedBranchId }, { branchId: null }];
  } else if (branchId) {
    match.$or = [{ branchId: toOid(branchId) }, { branchId: null }];
  }

  return match;
};

const assertCanViewDocument = (doc, standing) => {
  if (
    standing.role === MembershipRole.SITE_MANAGER ||
    standing.role === MembershipRole.LINE_MANAGER
  ) {
    if (doc.branchId && String(doc.branchId) !== String(standing.branchId)) {
      throw new AppError("outside_managed_branch", 403);
    }
  }
};

const loadShaped = async (match) => {
  const [row] = await Document.aggregate([
    { $match: match },
    { $limit: 1 },
    ...versionLookup,
  ]);
  if (!row) throw new AppError("document_not_found", 404);
  return shapeDocument(row);
};

const listDocuments = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  keyword,
  category,
  categoryId,
  audience,
  scope,
  requiresSignature,
}) => {
  const standing = await actorStanding(actor, organizationId);
  if (branchId) await assertBranchInOrganization(branchId, organizationId);

  const match = visibleMatch(organizationId, standing, branchId);
  if (
    (categoryId && categoryId !== "all") ||
    (category && category !== "all")
  ) {
    match.categoryId = await resolveCategoryId({
      organizationId,
      categoryId: categoryId && categoryId !== "all" ? categoryId : undefined,
      category,
      allowInactive: true,
    });
  }
  if (audience) {
    if (!AUDIENCES.has(audience))
      throw new AppError("invalid_document_audience", 400);
    match.audiences = audience;
  }
  if (scope && scope !== "all") {
    if (!SCOPES.has(scope)) throw new AppError("invalid_document_scope", 400);
    match.scope = scope;
  }
  if (requiresSignature === "true" || requiresSignature === true) {
    match.requiresSignature = true;
  } else if (requiresSignature === "false" || requiresSignature === false) {
    match.requiresSignature = false;
  }

  const search = keywordOr(keyword, ["title"], { trim: true });
  if (search) match.$and = [...(match.$and || []), { $or: search }];

  const { data, meta } = await paginateWithFacet({
    model: Document,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: versionLookup,
  });

  return { data: data.map(shapeDocument), meta };
};

const getDocument = async ({ actor, organizationId, documentId }) => {
  const standing = await actorStanding(actor, organizationId);
  const row = await loadShaped({
    _id: toOid(documentId),
    organizationId,
  });
  assertCanViewDocument(row, standing);
  return row;
};

const createDocument = async ({
  actor,
  organizationId,
  title,
  category,
  categoryId,
  audiences,
  branchId,
  requiresSignature,
  file,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const name = String(title || "").trim();
  if (!name) throw new AppError("document_title_required", 400);

  let siteId = branchId || null;
  if (standing.role === MembershipRole.SITE_MANAGER) {
    siteId = standing.branchId;
  }
  if (siteId) await assertBranchInOrganization(siteId, organizationId);
  assertMayManageStaff(standing, siteId || standing.branchId);

  const storedFile = parseStoredFile(file);
  const resolvedCategoryId = await resolveCategoryId({
    organizationId,
    categoryId,
    category,
    fallbackToOther: true,
  });
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [doc] = await Document.create(
      [
        {
          organizationId,
          branchId: siteId || null,
          ownerUserId: actor._id,
          title: name,
          scope: siteId ? DocumentScope.BRANCH : DocumentScope.ORG,
          categoryId: resolvedCategoryId,
          audiences: parseAudiences(audiences),
          requiresSignature: requiresSignature !== false,
        },
      ],
      { session },
    );

    const [version] = await DocumentVersion.create(
      [
        {
          documentId: doc._id,
          version: 1,
          file: storedFile,
          uploadedBy: actor._id,
        },
      ],
      { session },
    );

    doc.currentVersionId = version._id;
    await doc.save({ session });
    await session.commitTransaction();

    return loadShaped({ _id: doc._id });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const updateDocument = async ({
  actor,
  organizationId,
  documentId,
  title,
  category,
  categoryId,
  audiences,
  branchId,
  requiresSignature,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const doc = await Document.findOne({
    _id: toOid(documentId),
    organizationId,
  });
  if (!doc) throw new AppError("document_not_found", 404);
  assertCanViewDocument(doc, standing);
  assertMayManageStaff(standing, doc.branchId || standing.branchId);

  if (title !== undefined) {
    const name = String(title || "").trim();
    if (!name) throw new AppError("document_title_required", 400);
    doc.title = name;
  }
  if (categoryId !== undefined || category !== undefined) {
    doc.categoryId = await resolveCategoryId({
      organizationId,
      categoryId,
      category,
      fallbackToOther:
        categoryId === null || category === null || category === "",
    });
  }
  if (audiences !== undefined) doc.audiences = parseAudiences(audiences);
  if (requiresSignature !== undefined) {
    doc.requiresSignature = Boolean(requiresSignature);
  }
  if (branchId !== undefined) {
    let siteId = branchId || null;
    if (standing.role === MembershipRole.SITE_MANAGER) {
      siteId = standing.branchId;
    }
    if (siteId) await assertBranchInOrganization(siteId, organizationId);
    assertMayManageStaff(standing, siteId || standing.branchId);
    doc.branchId = siteId;
    doc.scope = siteId ? DocumentScope.BRANCH : DocumentScope.ORG;
  }

  await doc.save();
  return loadShaped({ _id: doc._id });
};

const deleteDocument = async ({ actor, organizationId, documentId }) => {
  const standing = await actorStanding(actor, organizationId);
  const doc = await Document.findOne({
    _id: toOid(documentId),
    organizationId,
  });
  if (!doc) throw new AppError("document_not_found", 404);
  assertCanViewDocument(doc, standing);
  assertMayManageStaff(standing, doc.branchId || standing.branchId);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await DocumentSignature.deleteMany({ documentId: doc._id }, { session });
    await DocumentVersion.deleteMany({ documentId: doc._id }, { session });
    await doc.deleteOne({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  return { _id: doc._id };
};

const addDocumentVersion = async ({
  actor,
  organizationId,
  documentId,
  file,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const doc = await Document.findOne({
    _id: toOid(documentId),
    organizationId,
  });
  if (!doc) throw new AppError("document_not_found", 404);
  assertCanViewDocument(doc, standing);
  assertMayManageStaff(standing, doc.branchId || standing.branchId);

  const storedFile = parseStoredFile(file);
  const latest = await DocumentVersion.findOne({ documentId: doc._id })
    .sort({ version: -1 })
    .select("version")
    .lean();

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [version] = await DocumentVersion.create(
      [
        {
          documentId: doc._id,
          version: (latest?.version || 0) + 1,
          file: storedFile,
          uploadedBy: actor._id,
        },
      ],
      { session },
    );
    doc.currentVersionId = version._id;
    await doc.save({ session });
    await session.commitTransaction();
    return loadShaped({ _id: doc._id });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const listDocumentAcknowledgements = async ({
  actor,
  organizationId,
  documentId,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const doc = await Document.findOne({
    _id: toOid(documentId),
    organizationId,
  })
    .select("_id branchId")
    .lean();
  if (!doc) throw new AppError("document_not_found", 404);
  assertCanViewDocument(doc, standing);

  const { data, meta } = await paginateWithFacet({
    model: DocumentSignature,
    match: { documentId: doc._id },
    page,
    limit,
    skip,
    sort: { signedAt: -1 },
    extraDataStages: [
      {
        $lookup: {
          from: User.collection.name,
          localField: "signerUserId",
          foreignField: "_id",
          as: "_user",
          pipeline: [{ $project: { name: 1, email: 1 } }],
        },
      },
      {
        $lookup: {
          from: StaffProfile.collection.name,
          localField: "signerStaffId",
          foreignField: "_id",
          as: "_staff",
          pipeline: [{ $project: { employeeCode: 1, photoUrl: 1 } }],
        },
      },
      {
        $lookup: {
          from: ExternalPerson.collection.name,
          localField: "signerExternalPersonId",
          foreignField: "_id",
          as: "_person",
          pipeline: [{ $project: { name: 1, type: 1 } }],
        },
      },
    ],
  });

  return {
    data: data.map((row) => ({
      _id: row._id,
      documentId: row.documentId,
      documentVersionId: row.documentVersionId,
      branchId: row.branchId,
      signerName: row.signerName,
      signatureUrl: toPublicImageUrl(row.signatureUrl),
      signedAt: row.signedAt,
      user: row._user?.[0] || null,
      staff: row._staff?.[0] || null,
      person: row._person?.[0] || null,
    })),
    meta,
  };
};

const MAX_BULK_FILES = 20;

const fileTitle = (name) =>
  String(name || "")
    .replace(/\.[^.]+$/, "")
    .trim();

const bulkCreateDocuments = async ({
  actor,
  organizationId,
  branchId,
  categoryId,
  audiences,
  requiresSignature,
  files,
}) => {
  if (!Array.isArray(files) || !files.length || files.length > MAX_BULK_FILES)
    throw new AppError("invalid_bulk_upload", 400, { max: MAX_BULK_FILES });
  if (categoryId) await resolveCategoryId({ organizationId, categoryId });

  const created = [];
  const failed = [];
  let firstError = null;
  for (const [index, entry] of files.entries()) {
    const title =
      String(entry?.title || "").trim() || fileTitle(entry?.file?.originalName);
    try {
      const doc = await createDocument({
        actor,
        organizationId,
        branchId,
        categoryId,
        audiences,
        requiresSignature: [true, "true"].includes(requiresSignature),
        title,
        file: entry?.file,
      });
      created.push({ _id: doc._id, title: doc.title });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      firstError = firstError || error;
      failed.push({ index, title, error: error.message });
    }
  }
  if (!created.length) throw firstError;
  return { created, failed };
};

const QR_CAPTION_MAX = 80;
const QR_LINK_MAX = 2000;
const PDF_PAGE_COUNT_LIMIT = 10 * 1024 * 1024;
const PUBLIC_AUDIENCES = [
  DocumentAudience.VISITOR,
  DocumentAudience.CONTRACTOR,
];

const pdfPages = async (file) => {
  if (file?.mimeType !== "application/pdf" || !file.key) return null;
  if (file.sizeBytes > PDF_PAGE_COUNT_LIMIT) return null;
  try {
    const buffer = await uploadAwsService.getObject(file.key);
    const pages = (
      buffer.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g) || []
    ).length;
    return pages || null;
  } catch (error) {
    return undefined;
  }
};

const cleanQrLink = (value) => {
  const text = String(value ?? "").trim();
  let url;
  try {
    url = new URL(text);
  } catch (error) {
    throw new AppError("invalid_qr_link", 400);
  }
  if (url.protocol !== "https:" || text.length > QR_LINK_MAX)
    throw new AppError("invalid_qr_link", 400);
  return url.href;
};

const SHARED_LINK_SECONDS = 300;
const INLINE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i;

const isVisitorFacing = (audiences) =>
  (audiences || []).some((audience) => PUBLIC_AUDIENCES.includes(audience));

const fileType = (file) => {
  const mime = String(file?.mimeType || "").toLowerCase();
  const name = String(file?.originalName || "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("word") || /\.docx?$/.test(name)) return "Word";
  return name.includes(".") ? name.split(".").pop().toUpperCase() : "File";
};

const fillPages = async (rows) => {
  const missing = rows.filter(
    (row) =>
      row._version?.file?.mimeType === "application/pdf" &&
      row._version.file.pages === undefined,
  );
  for (let at = 0; at < missing.length; at += 5) {
    await Promise.all(
      missing.slice(at, at + 5).map(async (row) => {
        const pages = await pdfPages(row._version.file);
        if (pages === undefined) return;
        row._version.file.pages = pages || 0;
        await DocumentVersion.updateOne(
          { _id: row._version._id },
          { $set: { "file.pages": pages || 0 } },
        );
      }),
    );
  }
};

const listVisitorDocuments = async ({
  actor,
  organizationId,
  branchId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const siteId = scopeBranchFilter(standing, branchId);
  if (!siteId) throw new AppError("branch_scope_required", 400);
  await assertBranchInOrganization(siteId, organizationId);

  const match = {
    organizationId: toOid(organizationId),
    $or: [{ branchId: toOid(siteId) }, { branchId: null }],
    audiences: { $in: PUBLIC_AUDIENCES },
    currentVersionId: { $ne: null },
  };
  const search = keywordOr(keyword, ["title"], { trim: true });
  if (search) match.$and = [{ $or: search }];

  const { data, meta } = await paginateWithFacet({
    model: Document,
    match,
    page,
    limit,
    skip,
    sort: { title: 1 },
    extraDataStages: versionLookup,
  });
  await fillPages(data);
  const active = await DocumentShareLink.find({
    documentId: { $in: data.map((row) => row._id) },
    active: true,
  })
    .select("documentId")
    .lean();
  const shared = new Set(active.map((row) => String(row.documentId)));

  return {
    data: data.map((row) => {
      const file = row._version?.file || null;
      return {
        _id: row._id,
        title: row.title,
        fileName: file?.originalName || row.title,
        type: fileType(file),
        pages: file?.pages || null,
        updatedAt: row.updatedAt,
        qrActive: shared.has(String(row._id)),
      };
    }),
    meta,
  };
};

const shareUrl = (baseUrl, token) =>
  `${String(baseUrl).replace(/\/+$/, "")}/api/v1/app/documents/shared/${token}`;

const activeShareLink = async ({ documentId, actor, organizationId }) => {
  const existing = await DocumentShareLink.findOne({
    documentId,
    active: true,
  }).lean();
  if (existing) return existing;
  try {
    const created = await DocumentShareLink.create({
      organizationId,
      documentId,
      token: crypto.randomBytes(32).toString("base64url"),
      createdBy: actor._id,
    });
    return created.toObject();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return DocumentShareLink.findOne({ documentId, active: true }).lean();
  }
};

const cleanCaption = (caption) => {
  const label = String(caption ?? "").trim();
  if (label.length > QR_CAPTION_MAX)
    throw new AppError("invalid_qr_caption", 400, { max: QR_CAPTION_MAX });
  return label;
};

const visitorDocument = async ({ actor, organizationId, documentId }) => {
  const doc = await getDocument({ actor, organizationId, documentId });
  if (!isVisitorFacing(doc.audiences))
    throw new AppError("document_not_public", 400);
  if (!doc.file?.key) throw new AppError("document_file_required", 400);
  return doc;
};

const documentQr = async ({ doc, actor, organizationId, label, baseUrl }) => {
  const link = await activeShareLink({
    documentId: doc._id,
    actor,
    organizationId,
  });
  const pages = await pdfPages(doc.file);
  return {
    title: doc.file.originalName || doc.title,
    caption:
      label ||
      (pages
        ? `${doc.title} - ${pages} Page${pages === 1 ? "" : "s"}`
        : doc.title),
    qrPayload: shareUrl(baseUrl, link.token),
  };
};

const createQrCode = async ({
  actor,
  organizationId,
  documentId,
  link,
  caption,
  baseUrl,
}) => {
  const hasDocument =
    documentId !== undefined && documentId !== null && documentId !== "";
  const hasLink = link !== undefined && link !== null && link !== "";
  if (hasDocument === hasLink) throw new AppError("qr_source_required", 400);
  const label = cleanCaption(caption);

  if (hasDocument) {
    const doc = await visitorDocument({ actor, organizationId, documentId });
    return documentQr({ doc, actor, organizationId, label, baseUrl });
  }
  const target = cleanQrLink(link);
  return {
    title: target,
    caption: label || new URL(target).hostname,
    qrPayload: target,
  };
};

const regenerateQrLink = async ({
  actor,
  organizationId,
  documentId,
  caption,
  baseUrl,
}) => {
  const label = cleanCaption(caption);
  const doc = await visitorDocument({ actor, organizationId, documentId });
  await DocumentShareLink.updateMany(
    { documentId: doc._id, active: true },
    { $set: { active: false, revokedAt: new Date(), revokedBy: actor._id } },
  );
  return documentQr({ doc, actor, organizationId, label, baseUrl });
};

const revokeQrLink = async ({ actor, organizationId, documentId }) => {
  const doc = await getDocument({ actor, organizationId, documentId });
  const result = await DocumentShareLink.updateOne(
    { documentId: doc._id, active: true },
    { $set: { active: false, revokedAt: new Date(), revokedBy: actor._id } },
  );
  if (!result.modifiedCount) throw new AppError("qr_link_not_found", 404);
  return { documentId: doc._id, qrActive: false };
};

const openFileUrl = async ({ file, title, expiresIn }) => {
  if (!file) return null;
  if (/^https?:\/\//i.test(file.key)) return file.key;
  const { url } = await uploadAwsService.signedPdfUrl({
    key: file.key,
    filename:
      String(file.originalName || title)
        .replace(/[^\w.\- ]+/g, "_")
        .slice(0, 120) || "document",
    attachment: !INLINE_TYPES.test(file.mimeType),
    contentType: file.mimeType || "application/octet-stream",
    expiresIn,
  });
  return url;
};

const getSharedDocumentUrl = async ({ token }) => {
  const unavailable = new AppError("qr_link_unavailable", 404);
  const value = String(token || "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) throw unavailable;
  const link = await DocumentShareLink.findOne({
    token: value,
    active: true,
  }).lean();
  if (!link) throw unavailable;

  const [row] = await Document.aggregate([
    { $match: { _id: link.documentId, organizationId: link.organizationId } },
    { $limit: 1 },
    ...versionLookup,
  ]);
  const file = row && versionFile(row._version);
  if (!file || !isVisitorFacing(row.audiences)) throw unavailable;

  return openFileUrl({
    file,
    title: row.title,
    expiresIn: SHARED_LINK_SECONDS,
  });
};

module.exports = {
  createQrCode,
  regenerateQrLink,
  revokeQrLink,
  getSharedDocumentUrl,
  listVisitorDocuments,
  bulkCreateDocuments,
  openFileUrl,
  fileType,
  isVisitorFacing,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  addDocumentVersion,
  listDocumentAcknowledgements,
  versionFile,
  shapeDocument,
  versionLookup,
};
