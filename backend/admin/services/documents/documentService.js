const mongoose = require("mongoose");
const { Document } = require("@models/Document");
const { DocumentVersion } = require("@models/DocumentVersion");
const { DocumentSignature } = require("@models/DocumentSignature");
const { User } = require("@models/UserModel");
const { StaffProfile } = require("@models/StaffProfile");
const { ExternalPerson } = require("@models/ExternalPerson");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { AppError } = require("@services/_errors/AppError");
const { DocumentScope, DocumentAudience, MembershipRole } = require("@models/domainEnums");
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
  const unique = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  if (!unique.length) return [DocumentAudience.STAFF];
  for (const item of unique) {
    if (!AUDIENCES.has(item)) throw new AppError("invalid_document_audience", 400);
  }
  return unique;
};

const parseStoredFile = (file) => {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new AppError("document_file_required", 400);
  }
  const key = String(file.key || "").trim();
  if (!key) throw new AppError("document_file_required", 400);
  if (/^https?:\/\//i.test(key)) throw new AppError("document_file_key_invalid", 400);

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
    if (
      doc.branchId &&
      String(doc.branchId) !== String(standing.branchId)
    ) {
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
  if ((categoryId && categoryId !== "all") || (category && category !== "all")) {
    match.categoryId = await resolveCategoryId({
      organizationId,
      categoryId: categoryId && categoryId !== "all" ? categoryId : undefined,
      category,
      allowInactive: true,
    });
  }
  if (audience) {
    if (!AUDIENCES.has(audience)) throw new AppError("invalid_document_audience", 400);
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
      { session }
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
      { session }
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
      fallbackToOther: categoryId === null || category === null || category === "",
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
      { session }
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

module.exports = {
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
