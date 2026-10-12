const mongoose = require("mongoose");
const { ExternalPerson } = require("@models/ExternalPerson");
const { Branch } = require("@models/Branch");
const { Department } = require("@models/Department");
const { VisitSession } = require("@models/VisitSession");
const { keywordOr, facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const {
  ExternalPersonType,
  VisitSessionStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./visitorAccess");

const DIRECTORY_TYPES = [
  ExternalPersonType.VISITOR,
  ExternalPersonType.CONTRACTOR,
  ExternalPersonType.PROFESSIONAL,
];

const SITE_STATUSES = ["onSite", "offSite"];

const toOid = (value, key = "invalid_id") => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const parsePersonType = (type) => {
  if (!Object.values(ExternalPersonType).includes(type)) {
    throw new AppError("invalid_external_person_type", 400);
  }
  return type;
};

const parseDirectoryTypes = (type) => {
  if (type === undefined || type === null || type === "" || type === "all") {
    return DIRECTORY_TYPES;
  }
  const list = Array.isArray(type)
    ? type
    : String(type)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  return [...new Set(list.map(parsePersonType))];
};

const parseSiteStatus = (value) => {
  if (value === undefined || value === null || value === "" || value === "all") {
    return null;
  }
  if (!SITE_STATUSES.includes(value)) {
    throw new AppError("invalid_site_status", 400);
  }
  return value;
};

const createExternalPersonAtBranch = async ({
  branchId,
  type,
  name,
  email,
  phone,
  photoUrl,
  carRegistration,
  departmentId,
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
    departmentId: departmentId || null,
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
  departmentId,
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
    departmentId,
    categoryId,
    visitorCategory,
  });
};

const directoryLookups = [
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      as: "_branch",
      pipeline: [{ $project: { name: 1, code: 1, status: 1 } }],
    },
  },
  {
    $lookup: {
      from: Department.collection.name,
      localField: "departmentId",
      foreignField: "_id",
      as: "_department",
      pipeline: [{ $project: { name: 1 } }],
    },
  },
  {
    $lookup: {
      from: VisitSession.collection.name,
      let: { personId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$externalPersonId", "$$personId"] },
                { $eq: ["$status", VisitSessionStatus.ON_SITE] },
              ],
            },
          },
        },
        { $project: { _id: 1, checkInAt: 1 } },
        { $limit: 1 },
      ],
      as: "_onSite",
    },
  },
  {
    $addFields: {
      branch: { $arrayElemAt: ["$_branch", 0] },
      department: { $arrayElemAt: ["$_department", 0] },
      siteStatus: {
        $cond: [{ $gt: [{ $size: "$_onSite" }, 0] }, "onSite", "offSite"],
      },
      onSite: { $gt: [{ $size: "$_onSite" }, 0] },
    },
  },
  {
    $project: {
      _branch: 0,
      _department: 0,
      _onSite: 0,
    },
  },
];

const listExternalPeople = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  departmentId,
  type,
  siteStatus,
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
  const branchIds = branches.map((row) => row._id);
  if (!branchIds.length) {
    return {
      data: [],
      meta: generateMeta(page, limit, 0),
    };
  }

  const match = {
    branchId: { $in: branchIds },
    type: { $in: parseDirectoryTypes(type) },
  };
  if (departmentId) match.departmentId = toOid(departmentId, "invalid_object_ids");

  const or = keywordOr(keyword, ["name", "email", "phone"], { trim: true });
  if (or) match.$or = or;

  const statusFilter = parseSiteStatus(siteStatus);
  const afterStatus = statusFilter ? [{ $match: { siteStatus: statusFilter } }] : [];

  const [result] = await ExternalPerson.aggregate([
    { $match: match },
    ...directoryLookups,
    ...afterStatus,
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  return {
    data: result?.data || [],
    meta: generateMeta(page, limit, facetCount(result?.totalCount)),
  };
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
  departmentId,
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
  if (departmentId !== undefined) update.departmentId = departmentId || null;
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
  DIRECTORY_TYPES,
  parsePersonType,
  createExternalPersonAtBranch,
  createExternalPerson,
  listExternalPeople,
  getExternalPerson,
  updateExternalPerson,
};
