const { ExternalPerson } = require("@models/ExternalPerson");
const { Branch } = require("@models/Branch");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { ExternalPersonType } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./visitorAccess");

const parsePersonType = (type) => {
  if (!Object.values(ExternalPersonType).includes(type)) {
    throw new AppError("invalid_external_person_type", 400);
  }
  return type;
};

const createExternalPersonAtBranch = async ({
  branchId,
  type,
  name,
  email,
  phone,
  photoUrl,
  carRegistration,
  categoryId,
  visitorCategory,
}) => {
  if (!branchId) throw new AppError("branch_required", 400);
  if (!name || !String(name).trim()) throw new AppError("name_required", 400);

  const person = await ExternalPerson.create({
    branchId,
    type: parsePersonType(type),
    name: String(name).trim(),
    email: email ? String(email).trim().toLowerCase() : "",
    phone: phone ? String(phone).trim() : "",
    photoUrl: photoUrl || "",
    carRegistration: carRegistration || "",
    categoryId: categoryId || null,
    visitorCategory: visitorCategory || "",
  });

  return person.toObject();
};

const createExternalPerson = async ({
  actor,
  organizationId,
  branchId,
  type,
  name,
  email,
  phone,
  photoUrl,
  carRegistration,
  categoryId,
  visitorCategory,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, branchId);
  await assertBranchInOrganization(branchId, organizationId);

  return createExternalPersonAtBranch({
    branchId,
    type,
    name,
    email,
    phone,
    photoUrl,
    carRegistration,
    categoryId,
    visitorCategory,
  });
};

const listExternalPeople = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  type,
  keyword,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);

  const branchFilter = { organizationId };
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchFilter._id = scopedBranchId;
  }

  const branches = await Branch.find(branchFilter).select("_id").lean();
  const branchIds = branches.map((b) => b._id);
  if (!branchIds.length) {
    return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }

  const match = {
    branchId: { $in: branchIds },
  };
  if (type) match.type = parsePersonType(type);

  const or = keywordOr(keyword, ["name", "email", "phone"], { trim: true });
  if (or) match.$or = or;

  return paginateWithFacet({
    model: ExternalPerson,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
  });
};

const getExternalPerson = async ({
  actor,
  organizationId,
  externalPersonId,
}) => {
  const person = await ExternalPerson.findById(externalPersonId).lean();
  if (!person) throw new AppError("external_person_not_found", 404);

  await assertBranchInOrganization(person.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, person.branchId);
  if (String(scoped) !== String(person.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }

  return person;
};

const updateExternalPerson = async ({
  actor,
  organizationId,
  externalPersonId,
  name,
  email,
  phone,
  photoUrl,
  carRegistration,
  categoryId,
  visitorCategory,
  type,
}) => {
  const person = await ExternalPerson.findById(externalPersonId);
  if (!person) throw new AppError("external_person_not_found", 404);

  await assertBranchInOrganization(person.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, person.branchId);

  const update = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw new AppError("name_required", 400);
    update.name = String(name).trim();
  }
  if (email !== undefined) update.email = String(email).trim().toLowerCase();
  if (phone !== undefined) update.phone = String(phone).trim();
  if (photoUrl !== undefined) update.photoUrl = photoUrl || "";
  if (carRegistration !== undefined) {
    update.carRegistration = carRegistration || "";
  }
  if (categoryId !== undefined) update.categoryId = categoryId || null;
  if (visitorCategory !== undefined) {
    update.visitorCategory = visitorCategory || "";
  }
  if (type !== undefined) update.type = parsePersonType(type);

  if (!Object.keys(update).length) throw new AppError("nothing_to_update", 400);

  Object.assign(person, update);
  await person.save();
  return person.toObject();
};

module.exports = {
  parsePersonType,
  createExternalPersonAtBranch,
  createExternalPerson,
  listExternalPeople,
  getExternalPerson,
  updateExternalPerson,
};
