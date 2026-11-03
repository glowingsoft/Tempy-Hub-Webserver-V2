const mongoose = require("mongoose");
const { DocumentCategory } = require("@models/DocumentCategory");
const { Document } = require("@models/Document");
const { User } = require("@models/UserModel");
const { DocumentCategory: DocumentCategoryKey } = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { nameKeyOf } = require("../../../helperUtils/nameKey");
const { MembershipRole } = require("@models/domainEnums");
const { actorStanding, duplicateKey } = require("./documentAccess");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { toPublicImageUrl } = require("@utils/imageHelper");

const SEEDED = [
  { legacyKey: DocumentCategoryKey.HEALTH_AND_SAFETY, title: "Health and Safety" },
  { legacyKey: DocumentCategoryKey.FIRE, title: "Fire" },
  { legacyKey: DocumentCategoryKey.CONTRACTORS, title: "Contractors" },
  { legacyKey: DocumentCategoryKey.POLICY, title: "Policy" },
  { legacyKey: DocumentCategoryKey.NEWSLETTER, title: "Newsletter" },
  { legacyKey: DocumentCategoryKey.OTHER, title: "Other" },
];

const POLICY_LEGACY_KEYS = [
  DocumentCategoryKey.HEALTH_AND_SAFETY,
  DocumentCategoryKey.POLICY,
  DocumentCategoryKey.CONTRACTORS,
];

const CATEGORY_ROLES = new Set([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
]);

const readyOrganizations = new Set();

const toOid = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError("invalid_id", 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const shapeCategory = (row) => {
  if (!row) return null;
  return {
    _id: row._id,
    organizationId: row.organizationId,
    title: row.title,
    active: row.active !== false,
    createdBy: row.createdBy || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const assertMayManageCategories = (standing) => {
  if (!CATEGORY_ROLES.has(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }
};

const ensureDocumentCategories = async (organizationId) => {
  const orgId = toOid(organizationId);
  const cacheKey = String(orgId);
  if (readyOrganizations.has(cacheKey)) return;

  const existing = await DocumentCategory.exists({ organizationId: orgId });
  if (!existing) {
    await DocumentCategory.insertMany(
      SEEDED.map((row) => ({
        organizationId: orgId,
        title: row.title,
        titleKey: nameKeyOf(row.title),
        legacyKey: row.legacyKey,
        active: true,
        createdBy: null,
      }))
    );
  }

  const seeded = await DocumentCategory.find({
    organizationId: orgId,
    legacyKey: { $in: SEEDED.map((row) => row.legacyKey) },
  })
    .select("_id legacyKey")
    .lean();
  const byKey = new Map(seeded.map((row) => [row.legacyKey, row._id]));
  const fallbackId = byKey.get(DocumentCategoryKey.OTHER);

  const legacyDocs = await Document.collection
    .find({ organizationId: orgId, category: { $type: "string" } })
    .project({ _id: 1, category: 1 })
    .toArray();

  if (legacyDocs.length && fallbackId) {
    await Document.collection.bulkWrite(
      legacyDocs.map((doc) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: { categoryId: byKey.get(doc.category) || fallbackId },
            $unset: { category: "" },
          },
        },
      }))
    );
  }

  readyOrganizations.add(cacheKey);
};

const activeFilterOf = (status) => {
  if (status == null || String(status).trim() === "") return null;
  const value = String(status).trim().toLowerCase();
  if (value === "active") return true;
  if (value === "inactive") return false;
  throw new AppError("invalid_document_category_status", 400);
};

const shapeListedCategory = (row) => {
  const creator = row.createdByUser?.[0] || null;
  const base = shapeCategory(row);
  return {
    ...base,
    createdBy: creator
      ? {
          _id: creator._id,
          name: creator.name || "",
          email: creator.email || "",
          profileIcon: toPublicImageUrl(creator.profileIcon),
        }
      : null,
    documentCount: row.documentStats?.[0]?.count || 0,
  };
};

const listDocumentCategories = async ({
  actor,
  organizationId,
  status,
  keyword,
  page,
  limit,
  skip,
}) => {
  await actorStanding(actor, organizationId);
  await ensureDocumentCategories(organizationId);

  const match = { organizationId: toOid(organizationId) };
  const search = keywordOr(keyword, ["title"], { trim: true });
  if (search) match.$or = search;

  const countMatch = { ...match };
  const activeFilter = activeFilterOf(status);
  if (activeFilter !== null) match.active = activeFilter;

  const { data, meta, result } = await paginateWithFacet({
    model: DocumentCategory,
    match,
    page,
    limit,
    skip,
    sort: { title: 1 },
    extraDataStages: [
      {
        $lookup: {
          from: User.collection.name,
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser",
          pipeline: [{ $project: { name: 1, email: 1, profileIcon: 1 } }],
        },
      },
      {
        $lookup: {
          from: Document.collection.name,
          localField: "_id",
          foreignField: "categoryId",
          as: "documentStats",
          pipeline: [{ $count: "count" }],
        },
      },
    ],
    extraFacets: {
      activeCount: [{ $match: { ...countMatch, active: true } }, { $count: "count" }],
      inactiveCount: [{ $match: { ...countMatch, active: false } }, { $count: "count" }],
    },
  });

  return {
    data: data.map(shapeListedCategory),
    meta: {
      ...meta,
      counts: {
        active: facetCount(result.activeCount),
        inactive: facetCount(result.inactiveCount),
      },
    },
  };
};

const createDocumentCategory = async ({ actor, organizationId, title }) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageCategories(standing);
  await ensureDocumentCategories(organizationId);

  const nextTitle = String(title || "").trim();
  if (!nextTitle) throw new AppError("document_category_title_required", 400);

  try {
    const row = await DocumentCategory.create({
      organizationId: toOid(organizationId),
      title: nextTitle,
      active: true,
      createdBy: actor._id,
    });
    return shapeCategory(row.toObject());
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("document_category_title_taken", 409);
    throw error;
  }
};

const updateDocumentCategory = async ({
  actor,
  organizationId,
  categoryId,
  title,
  active,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageCategories(standing);
  await ensureDocumentCategories(organizationId);

  const row = await DocumentCategory.findOne({
    _id: toOid(categoryId),
    organizationId: toOid(organizationId),
  });
  if (!row) throw new AppError("document_category_not_found", 404);

  if (title !== undefined) {
    const nextTitle = String(title || "").trim();
    if (!nextTitle) throw new AppError("document_category_title_required", 400);
    row.title = nextTitle;
  }
  if (active !== undefined) row.active = Boolean(active);

  try {
    await row.save();
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("document_category_title_taken", 409);
    throw error;
  }

  return shapeCategory(row.toObject());
};

const deleteDocumentCategory = async ({ actor, organizationId, categoryId }) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageCategories(standing);
  await ensureDocumentCategories(organizationId);

  const orgId = toOid(organizationId);
  const row = await DocumentCategory.findOne({
    _id: toOid(categoryId),
    organizationId: orgId,
  });
  if (!row) throw new AppError("document_category_not_found", 404);

  const inUse = await Document.exists({ organizationId: orgId, categoryId: row._id });
  if (inUse) throw new AppError("document_category_in_use", 409);

  await row.deleteOne();
  return { _id: row._id };
};

/**
 * Active category in this organization.
 * `categoryId` wins. A legacy slug or a title still resolves so older clients keep working.
 * Omitted on create falls back to Other.
 */
const resolveCategoryId = async ({
  organizationId,
  categoryId,
  category,
  fallbackToOther,
  allowInactive,
}) => {
  await ensureDocumentCategories(organizationId);
  const orgId = toOid(organizationId);
  const activeFilter = allowInactive ? {} : { active: true };

  if (categoryId) {
    const row = await DocumentCategory.findOne({
      _id: toOid(categoryId),
      organizationId: orgId,
      ...activeFilter,
    })
      .select("_id")
      .lean();
    if (!row) throw new AppError("document_category_not_found", 404);
    return row._id;
  }

  if (category != null && String(category).trim() && String(category) !== "all") {
    const raw = String(category).trim();
    const row = await DocumentCategory.findOne({
      organizationId: orgId,
      ...activeFilter,
      $or: [{ legacyKey: raw }, { titleKey: nameKeyOf(raw) }],
    })
      .select("_id")
      .lean();
    if (!row) throw new AppError("invalid_document_category", 400);
    return row._id;
  }

  if (!fallbackToOther) return undefined;

  const other = await DocumentCategory.findOne({
    organizationId: orgId,
    legacyKey: DocumentCategoryKey.OTHER,
  })
    .select("_id")
    .lean();
  if (!other) throw new AppError("document_category_not_found", 404);
  return other._id;
};

const policyCategoryIds = async (organizationId) => {
  await ensureDocumentCategories(organizationId);
  const rows = await DocumentCategory.find({
    organizationId: toOid(organizationId),
    legacyKey: { $in: POLICY_LEGACY_KEYS },
  })
    .select("_id")
    .lean();
  return rows.map((row) => row._id);
};

module.exports = {
  ensureDocumentCategories,
  listDocumentCategories,
  createDocumentCategory,
  updateDocumentCategory,
  deleteDocumentCategory,
  resolveCategoryId,
  policyCategoryIds,
  shapeCategory,
};
