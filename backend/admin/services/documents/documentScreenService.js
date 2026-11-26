const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Document } = require("@models/Document");
const { DocumentVersion } = require("@models/DocumentVersion");
const { DocumentSignature } = require("@models/DocumentSignature");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { JobTitle } = require("@models/JobTitle");
const { Department } = require("@models/Department");
const { Branch } = require("@models/Branch");
const { generateMeta } = require("@utils/responseUtil");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { AppError } = require("@services/_errors/AppError");
const { DocumentAudience, StaffProfileStatus } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./documentAccess");
const {
  versionFile,
  fileType,
  isVisitorFacing,
  openFileUrl,
} = require("./documentService");
const { mustSign } = require("./documentSigners");

const PREVIEW_SECONDS = 3600;
const DAY_FORMAT = "YYYY-MM-DD";
const DEFAULT_TIMEZONE = "Europe/London";
const STATUS_LABELS = { signed: "Signed", waiting: "Waiting", draft: "Draft" };
const DOCUMENT_FIELDS =
  "title branchId createdAt currentVersionId requiresSignature audiences signers signersOnly";

const mapById = (rows) => new Map(rows.map((row) => [String(row._id), row]));

const siteOf = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const siteId = scopeBranchFilter(standing, branchId);
  if (!siteId) throw new AppError("branch_scope_required", 400);
  assertMayManageStaff(standing, siteId);
  await assertBranchInOrganization(siteId, organizationId);
  return siteId;
};

const activeStaff = (organizationId, branchId) =>
  StaffProfile.find({
    organizationId,
    branchId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id branchId userId photoUrl jobTitleId departmentIds")
    .lean();

const versionsById = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await DocumentVersion.find({ _id: { $in: ids } })
    .select("file")
    .lean();
  return mapById(rows);
};

const fileOf = (document, version) => {
  const file = versionFile(version);
  return {
    _id: document._id,
    title: document.title,
    fileName: file?.originalName || document.title,
    type: fileType(file),
    sizeBytes: file?.sizeBytes || 0,
    createdAt: document.createdAt,
  };
};

const isForStaff = (document) =>
  !document.audiences?.length ||
  document.audiences.includes(DocumentAudience.STAFF);

const statusOf = (document, staff, signed) => {
  const required =
    isForStaff(document) &&
    document.requiresSignature !== false &&
    document.currentVersionId
      ? staff.filter((member) => mustSign(document, member))
      : [];
  if (!required.length) return "draft";
  return required.every((member) =>
    signed.has(`${document.currentVersionId}:${member._id}`),
  )
    ? "signed"
    : "waiting";
};

const getDocumentsScreen = async ({
  actor,
  organizationId,
  branchId,
  page,
  limit,
  skip,
}) => {
  const siteId = await siteOf({ actor, organizationId, branchId });
  const [documents, staff] = await Promise.all([
    Document.find({
      organizationId,
      $or: [{ branchId: siteId }, { branchId: null }],
    })
      .sort({ createdAt: -1 })
      .select(DOCUMENT_FIELDS)
      .lean(),
    activeStaff(organizationId, siteId),
  ]);

  const versionIds = documents
    .map((row) => row.currentVersionId)
    .filter(Boolean);
  const signatures =
    versionIds.length && staff.length
      ? await DocumentSignature.find({
          documentVersionId: { $in: versionIds },
          signerStaffId: { $in: staff.map((row) => row._id) },
        })
          .select("documentVersionId signerStaffId")
          .lean()
      : [];
  const signed = new Set(
    signatures.map((row) => `${row.documentVersionId}:${row.signerStaffId}`),
  );
  const rows = documents.map((document) => ({
    document,
    status: statusOf(document, staff, signed),
  }));

  const shown = rows.slice(skip, skip + limit);
  const versions = await versionsById(
    shown.map((row) => row.document.currentVersionId).filter(Boolean),
  );
  const list = await Promise.all(
    shown.map(async ({ document, status }) => {
      const version = versions.get(String(document.currentVersionId));
      return {
        ...fileOf(document, version),
        status: { key: status, label: STATUS_LABELS[status] },
        url: await openFileUrl({
          file: versionFile(version),
          title: document.title,
          expiresIn: PREVIEW_SECONDS,
        }),
      };
    }),
  );

  return {
    data: {
      summary: {
        total: rows.length,
        waitingSignature: rows.filter((row) => row.status === "waiting").length,
      },
      documents: list,
    },
    meta: generateMeta(page, limit, rows.length),
  };
};

const signableDocument = async ({
  actor,
  organizationId,
  documentId,
  branchId,
}) => {
  if (!mongoose.Types.ObjectId.isValid(String(documentId))) {
    throw new AppError("invalid_document_id", 400);
  }
  const document = await Document.findOne({ _id: documentId, organizationId })
    .select(DOCUMENT_FIELDS)
    .lean();
  if (!document) throw new AppError("document_not_found", 404);
  const siteId = await siteOf({
    actor,
    organizationId,
    branchId: branchId || document.branchId,
  });
  if (document.branchId && String(document.branchId) !== String(siteId)) {
    throw new AppError("document_not_found", 404);
  }
  if (!document.currentVersionId) {
    throw new AppError("document_version_missing", 400);
  }
  if (
    document.requiresSignature === false &&
    isVisitorFacing(document.audiences)
  ) {
    throw new AppError("visitor_document_not_assignable", 400);
  }
  const branch = await Branch.findById(siteId).select("timezone").lean();
  return { document, siteId, timezone: branch?.timezone || DEFAULT_TIMEZONE };
};

const getSignatureRequest = async (params) => {
  const { document, siteId, timezone } = await signableDocument(params);
  const [versions, staff] = await Promise.all([
    versionsById([document.currentVersionId]),
    activeStaff(params.organizationId, siteId),
  ]);
  const [users, jobTitles, departments] = await Promise.all([
    User.find({ _id: { $in: staff.map((row) => row.userId) } })
      .select("name profileIcon")
      .lean(),
    JobTitle.find({
      _id: { $in: staff.map((row) => row.jobTitleId).filter(Boolean) },
    })
      .select("name")
      .lean(),
    Department.find({
      _id: { $in: staff.flatMap((row) => row.departmentIds || []) },
    })
      .select("name sortOrder")
      .lean(),
  ]);
  const userById = mapById(users);
  const jobById = mapById(jobTitles);
  const departmentById = mapById(departments);
  const order = (department) => department?.sortOrder ?? 9999;

  const named = (document.signers || []).filter(
    (row) => String(row.branchId) === String(siteId),
  );
  const assigned = new Set(named.map((row) => String(row.staffId)));
  const latest = [...named].sort(
    (a, b) => new Date(b.assignedAt) - new Date(a.assignedAt),
  )[0];

  const people = staff
    .map((member) => {
      const user = userById.get(String(member.userId));
      const department = departmentById.get(String(member.departmentIds?.[0]));
      return {
        sortOrder: order(department),
        row: {
          _id: member._id,
          name: user?.name || "",
          photoUrl: toPublicImageUrl(member.photoUrl || user?.profileIcon),
          jobTitle: jobById.get(String(member.jobTitleId))?.name || "",
          department: department?.name || "",
          departmentIds: member.departmentIds || [],
          assigned: assigned.has(String(member._id)),
        },
      };
    })
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.row.name.localeCompare(b.row.name),
    );

  return {
    document: fileOf(document, versions.get(String(document.currentVersionId))),
    signBy: latest
      ? moment.tz(latest.signBy, timezone).format(DAY_FORMAT)
      : null,
    departments: [...departments]
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
      .map((row) => ({ _id: row._id, name: row.name })),
    staff: people.map((person) => person.row),
  };
};

const sendForSignature = async ({ staffIds, signBy, ...params }) => {
  const { document, siteId, timezone } = await signableDocument(params);

  const ids = [
    ...new Set((Array.isArray(staffIds) ? staffIds : []).map(String)),
  ];
  const staff = await activeStaff(params.organizationId, siteId);
  const staffById = mapById(staff);
  if (!ids.length || ids.some((id) => !staffById.has(id))) {
    throw new AppError("invalid_signature_staff", 400);
  }
  const day = moment.tz(String(signBy || ""), DAY_FORMAT, true, timezone);
  if (!day.isValid() || day.isBefore(moment.tz(timezone), "day")) {
    throw new AppError("invalid_sign_by_date", 400);
  }

  const assignedAt = new Date();
  const dueAt = day.clone().endOf("day").toDate();
  await Document.updateOne(
    { _id: document._id },
    { $pull: { signers: { staffId: { $in: ids } } } },
  );
  await Document.updateOne(
    { _id: document._id },
    {
      $push: {
        signers: {
          $each: ids.map((id) => ({
            staffId: staffById.get(id)._id,
            branchId: siteId,
            signBy: dueAt,
            assignedBy: params.actor._id,
            assignedAt,
          })),
        },
      },
      $set: {
        requiresSignature: true,
        signersOnly:
          document.signersOnly === true || document.requiresSignature === false,
      },
      $addToSet: { audiences: DocumentAudience.STAFF },
    },
  );

  return {
    documentId: document._id,
    assigned: ids.length,
    signBy: day.format(DAY_FORMAT),
  };
};

module.exports = {
  getDocumentsScreen,
  getSignatureRequest,
  sendForSignature,
};
