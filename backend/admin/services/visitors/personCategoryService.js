const mongoose = require("mongoose");
const { PersonCategory } = require("@models/PersonCategory");
const { ExternalPerson } = require("@models/ExternalPerson");
const { AppError } = require("@services/_errors/AppError");
const { nameKeyOf } = require("../../../helperUtils/nameKey");
const { PersonCategoryAppliesTo, MembershipRole } = require("@models/domainEnums");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const {
  actorStanding,
  assertBranchInOrganization,
} = require("./visitorAccess");
const { duplicateKey } = require("@adminServices/staff/staffAccess");

const CATEGORY_ROLES = new Set([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
]);

const DEFAULT_PERSON_CATEGORIES = [
  { name: "Family / Friend", appliesTo: PersonCategoryAppliesTo.VISITOR },
  { name: "Contractor", appliesTo: PersonCategoryAppliesTo.CONTRACTOR },
  { name: "Professional", appliesTo: PersonCategoryAppliesTo.ANY },
];

const readyOrganizations = new Set();

const toOid = (value, key = "invalid_id") => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const assertMayManageCategories = (standing) => {
  if (!CATEGORY_ROLES.has(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }
};

const parseAppliesTo = (value) => {
  if (value == null || value === "") return PersonCategoryAppliesTo.ANY;
  if (!Object.values(PersonCategoryAppliesTo).includes(value)) {
    throw new AppError("invalid_person_category_applies_to", 400);
  }
  return value;
};

const activeFilterOf = (status) => {
  if (status == null || String(status).trim() === "") return null;
  const next = String(status).trim().toLowerCase();
  if (next === "active") return true;
  if (next === "inactive") return false;
  throw new AppError("invalid_person_category_status", 400);
};

const shapeCategory = (row) => {
  if (!row) return null;
  return {
    _id: row._id,
    organizationId: row.organizationId || null,
    branchId: row.branchId || null,
    name: row.name,
    appliesTo: row.appliesTo,
    active: row.active !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

const seedRows = (organizationId, rows) =>
  rows.map((row) => ({
    organizationId,
    branchId: null,
    name: row.name,
    nameKey: nameKeyOf(row.name),
    appliesTo: row.appliesTo || PersonCategoryAppliesTo.ANY,
    active: row.active !== false,
  }));

const ensureOrgPersonCategories = async (organizationId) => {
  const orgId = toOid(organizationId, "invalid_organization_id");
  const cacheKey = String(orgId);
  if (readyOrganizations.has(cacheKey)) return;

  const exists = await PersonCategory.exists({ organizationId: orgId });
  if (!exists) {
    const globals = await PersonCategory.find({
      organizationId: null,
      branchId: null,
    }).lean();
    await PersonCategory.insertMany(
      seedRows(orgId, globals.length ? globals : DEFAULT_PERSON_CATEGORIES)
    );
  }

  readyOrganizations.add(cacheKey);
};

const listVisitCategories = async ({ organizationId, branchId }) => {
  await ensureOrgPersonCategories(organizationId);
  const orgId = toOid(organizationId, "invalid_organization_id");
  const or = [{ organizationId: orgId, branchId: null }];
  if (branchId) {
    or.push({
      organizationId: orgId,
      branchId: toOid(branchId, "invalid_branch_id"),
    });
  }

  const rows = await PersonCategory.find({ active: true, $or: or })
    .sort({ name: 1 })
    .lean();

  return rows.map((row) => ({
    _id: row._id,
    name: row.name,
    appliesTo: row.appliesTo,
  }));
};

const listPersonCategories = async ({
  actor,
  organizationId,
  status,
  keyword,
  appliesTo,
  branchId,
  page,
  limit,
  skip,
}) => {
  await actorStanding(actor, organizationId);
  await ensureOrgPersonCategories(organizationId);

  const match = { organizationId: toOid(organizationId, "invalid_organization_id") };
  if (branchId) match.branchId = toOid(branchId, "invalid_branch_id");

  const search = keywordOr(keyword, ["name"], { trim: true });
  if (search) match.$or = search;

  if (appliesTo) match.appliesTo = parseAppliesTo(appliesTo);

  const countMatch = { ...match };
  const activeFilter = activeFilterOf(status);
  if (activeFilter !== null) match.active = activeFilter;

  const { data, meta, result } = await paginateWithFacet({
    model: PersonCategory,
    match,
    page,
    limit,
    skip,
    sort: { name: 1 },
    extraDataStages: [
      {
        $lookup: {
          from: ExternalPerson.collection.name,
          localField: "_id",
          foreignField: "categoryId",
          as: "personStats",
          pipeline: [{ $count: "count" }],
        },
      },
    ],
    extraFacets: {
      allCount: [{ $match: countMatch }, { $count: "count" }],
      activeCount: [{ $match: { ...countMatch, active: true } }, { $count: "count" }],
      inactiveCount: [
        { $match: { ...countMatch, active: false } },
        { $count: "count" },
      ],
    },
  });

  return {
    data: data.map((row) => ({
      ...shapeCategory(row),
      personCount: row.personStats?.[0]?.count || 0,
    })),
    meta: {
      ...meta,
      counts: {
        all: facetCount(result.allCount),
        active: facetCount(result.activeCount),
        inactive: facetCount(result.inactiveCount),
      },
    },
  };
};

const createPersonCategory = async ({
  actor,
  organizationId,
  name,
  appliesTo,
  branchId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageCategories(standing);
  await ensureOrgPersonCategories(organizationId);

  const nextName = String(name || "").trim();
  if (!nextName) throw new AppError("person_category_name_required", 400);

  let scopedBranchId = null;
  if (branchId) {
    await assertBranchInOrganization(branchId, organizationId);
    scopedBranchId = toOid(branchId, "invalid_branch_id");
  }

  try {
    const row = await PersonCategory.create({
      organizationId: toOid(organizationId, "invalid_organization_id"),
      branchId: scopedBranchId,
      name: nextName,
      appliesTo: parseAppliesTo(appliesTo),
      active: true,
    });
    return shapeCategory(row.toObject());
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("person_category_name_taken", 409);
    throw error;
  }
};

const updatePersonCategory = async ({
  actor,
  organizationId,
  categoryId,
  name,
  appliesTo,
  active,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageCategories(standing);

  const row = await PersonCategory.findOne({
    _id: toOid(categoryId, "invalid_id"),
    organizationId: toOid(organizationId, "invalid_organization_id"),
  });
  if (!row) throw new AppError("person_category_not_found", 404);

  if (name !== undefined) {
    const nextName = String(name || "").trim();
    if (!nextName) throw new AppError("person_category_name_required", 400);
    row.name = nextName;
  }
  if (appliesTo !== undefined) row.appliesTo = parseAppliesTo(appliesTo);
  if (active !== undefined) row.active = Boolean(active);

  try {
    await row.save();
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("person_category_name_taken", 409);
    throw error;
  }

  return shapeCategory(row.toObject());
};

const deletePersonCategory = async ({ actor, organizationId, categoryId }) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageCategories(standing);

  const orgId = toOid(organizationId, "invalid_organization_id");
  const row = await PersonCategory.findOne({
    _id: toOid(categoryId, "invalid_id"),
    organizationId: orgId,
  });
  if (!row) throw new AppError("person_category_not_found", 404);

  const inUse = await ExternalPerson.exists({ categoryId: row._id });
  if (inUse) throw new AppError("person_category_in_use", 409);

  await row.deleteOne();
  return { _id: row._id };
};

module.exports = {
  DEFAULT_PERSON_CATEGORIES,
  ensureOrgPersonCategories,
  listVisitCategories,
  listPersonCategories,
  createPersonCategory,
  updatePersonCategory,
  deletePersonCategory,
};
