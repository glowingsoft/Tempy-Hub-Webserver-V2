const mongoose = require("mongoose");
const { Document } = require("@models/Document");
const { DocumentSignature } = require("@models/DocumentSignature");
const { StaffProfile } = require("@models/StaffProfile");
const { facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const {
  DocumentAudience,
  StaffProfileStatus,
} = require("@models/domainEnums");
const { duplicateKey } = require("@adminServices/staff/staffAccess");
const {
  shapeDocument,
  versionLookup,
} = require("@adminServices/documents/documentService");

const toOid = (value, key = "invalid_id") => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const loadStaff = async (actor, organizationId) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id branchId")
    .lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);
  if (!staff.branchId) throw new AppError("staff_branch_required", 400);
  return staff;
};

const visibleMatch = (organizationId, branchId) => ({
  organizationId,
  audiences: DocumentAudience.STAFF,
  $or: [{ branchId }, { branchId: null }],
});

const signatureLookup = (staffId) => [
  {
    $lookup: {
      from: DocumentSignature.collection.name,
      let: { versionId: "$currentVersionId" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$documentVersionId", "$$versionId"] },
            signerStaffId: staffId,
          },
        },
        { $project: { signedAt: 1, signatureUrl: 1 } },
        { $limit: 1 },
      ],
      as: "_signature",
    },
  },
];

const shapeStaffDocument = (row) => {
  const base = shapeDocument(row);
  const signature = row._signature?.[0] || null;
  return {
    ...base,
    signed: Boolean(signature),
    signedAt: signature?.signedAt || null,
  };
};

const parseSignedFilter = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError("invalid_signed_filter", 400);
};

const signedMatch = (signed) => {
  if (signed === true) {
    return { $expr: { $gt: [{ $size: "$_signature" }, 0] } };
  }
  if (signed === false) {
    return {
      requiresSignature: { $ne: false },
      $expr: { $eq: [{ $size: "$_signature" }, 0] },
    };
  }
  return null;
};

const listStaffDocuments = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  signed,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const staff = await loadStaff(actor, orgOid);
  const filter = signedMatch(parseSignedFilter(signed));
  const pipeline = [
    { $match: visibleMatch(orgOid, staff.branchId) },
    ...signatureLookup(staff._id),
  ];
  if (filter) pipeline.push({ $match: filter });
  pipeline.push({
    $facet: {
      data: [
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        ...versionLookup,
      ],
      totalCount: [{ $count: "count" }],
    },
  });
  const [result] = await Document.aggregate(pipeline);
  const totalRecords = facetCount(result?.totalCount);
  return {
    data: (result?.data || []).map(shapeStaffDocument),
    meta: generateMeta(page, limit, totalRecords),
  };
};

const getStaffDocument = async ({ actor, organizationId, documentId }) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const staff = await loadStaff(actor, orgOid);
  const [row] = await Document.aggregate([
    {
      $match: {
        _id: toOid(documentId, "invalid_document_id"),
        ...visibleMatch(orgOid, staff.branchId),
      },
    },
    { $limit: 1 },
    ...versionLookup,
    ...signatureLookup(staff._id),
  ]);
  if (!row) throw new AppError("document_not_found", 404);
  return shapeStaffDocument(row);
};

const signStaffDocument = async ({
  actor,
  organizationId,
  documentId,
  signatureUrl,
  ipAddress,
  userAgent,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const staff = await loadStaff(actor, orgOid);
  const url = String(signatureUrl || "").trim();
  if (!url) throw new AppError("signature_required", 400);

  const doc = await Document.findOne({
    _id: toOid(documentId, "invalid_document_id"),
    ...visibleMatch(orgOid, staff.branchId),
  })
    .select("requiresSignature currentVersionId")
    .lean();
  if (!doc) throw new AppError("document_not_found", 404);
  if (!doc.requiresSignature) throw new AppError("document_not_signable", 400);
  if (!doc.currentVersionId) throw new AppError("document_version_missing", 400);

  const exists = await DocumentSignature.exists({
    documentVersionId: doc.currentVersionId,
    signerStaffId: staff._id,
  });
  if (exists) throw new AppError("document_already_signed", 409);

  try {
    await DocumentSignature.create({
      documentId: doc._id,
      documentVersionId: doc.currentVersionId,
      branchId: staff.branchId,
      signerUserId: actor._id,
      signerStaffId: staff._id,
      signerName: actor.name || "",
      signatureUrl: url,
      signedAt: new Date(),
      ipAddress: ipAddress || "",
      userAgent: userAgent || "",
    });
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("document_already_signed", 409);
    throw error;
  }

  return getStaffDocument({ actor, organizationId: orgOid, documentId: doc._id });
};

module.exports = {
  listStaffDocuments,
  getStaffDocument,
  signStaffDocument,
};
