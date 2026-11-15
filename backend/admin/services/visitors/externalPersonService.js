const mongoose = require("mongoose");
const { ExternalPerson } = require("@models/ExternalPerson");
const { Branch } = require("@models/Branch");
const { Department } = require("@models/Department");
const { VisitSession } = require("@models/VisitSession");
const { User } = require("@models/UserModel");
const { Membership } = require("@models/Membership");
const { userCache } = require("@config/nodeCache");
const { keywordOr, facetCount, allCountFacet } = require("@utils/paginate");
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
const CSV_EXPORT_LIMIT = 10000;
const CSV_HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Type",
  "Site",
  "Department",
  "Site status",
  "Car registration",
];

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

const parseHasAccount = (value) => {
  if (value === undefined || value === null || value === "" || value === "all") {
    return null;
  }
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError("invalid_has_account", 400);
};

const userAccountLookup = {
  $lookup: {
    from: User.collection.name,
    localField: "userId",
    foreignField: "_id",
    pipeline: [
      {
        $project: {
          name: 1,
          email: 1,
          phoneNumber: 1,
          profileIcon: 1,
          "accountState.status": 1,
          "accountState.userType": 1,
        },
      },
    ],
    as: "_user",
  },
};

const shapeUserAccount = {
  $addFields: {
    hasAccount: {
      $and: [
        { $ne: ["$userId", null] },
        { $gt: [{ $size: "$_user" }, 0] },
      ],
    },
    user: {
      $cond: [
        { $gt: [{ $size: "$_user" }, 0] },
        {
          _id: { $arrayElemAt: ["$_user._id", 0] },
          name: { $arrayElemAt: ["$_user.name", 0] },
          email: { $arrayElemAt: ["$_user.email", 0] },
          phoneNumber: { $arrayElemAt: ["$_user.phoneNumber", 0] },
          profileIcon: { $arrayElemAt: ["$_user.profileIcon", 0] },
          status: { $arrayElemAt: ["$_user.accountState.status", 0] },
          userType: { $arrayElemAt: ["$_user.accountState.userType", 0] },
          active: {
            $eq: [{ $arrayElemAt: ["$_user.accountState.status", 0] }, "active"],
          },
        },
        null,
      ],
    },
  },
};

const normalizeVisitorEmail = (email) => String(email || "").trim().toLowerCase();

const toPersonObject = (person) =>
  person && typeof person.toObject === "function" ? person.toObject() : person;

const findPersonByBranchEmail = async ({ branchId, email, session }) => {
  const normalised = normalizeVisitorEmail(email);
  if (!branchId || !normalised) return null;
  const query = ExternalPerson.findOne({ branchId, email: normalised });
  if (session) query.session(session);
  return query;
};

const resolveExternalPersonAtBranch = async ({
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
  session,
}) => {
  if (!branchId) throw new AppError("branch_required", 400);
  const trimmedName = name ? String(name).trim() : "";
  const normalisedEmail = normalizeVisitorEmail(email);

  if (normalisedEmail) {
    const existing = await findPersonByBranchEmail({
      branchId,
      email: normalisedEmail,
      session,
    });
    if (existing) return { person: existing, created: false };
  }

  if (!trimmedName) throw new AppError("name_required", 400);

  const fields = {
    branchId,
    type: parsePersonType(type),
    name: trimmedName,
    email: normalisedEmail,
    phone: phone ? String(phone).trim() : "",
    photoUrl: photoUrl || "",
    carRegistration: carRegistration || "",
    departmentId: departmentId || null,
    categoryId: categoryId || null,
    visitorCategory: visitorCategory || "",
  };

  try {
    if (session) {
      const [created] = await ExternalPerson.create([fields], { session });
      return { person: created, created: true };
    }
    const created = await ExternalPerson.create(fields);
    return { person: created, created: true };
  } catch (error) {
    if (error.code === 11000 && normalisedEmail) {
      const existing = await findPersonByBranchEmail({
        branchId,
        email: normalisedEmail,
        session,
      });
      if (existing) return { person: existing, created: false };
    }
    throw error;
  }
};

const createExternalPersonAtBranch = async (payload) => {
  const { person } = await resolveExternalPersonAtBranch(payload);
  return toPersonObject(person);
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

const onSiteVisitLookup = {
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
};

/** Tab totals ignore the current siteStatus filter (same pattern as floor-plan counts). */
const siteStatusCountFacets = (countMatch) => ({
  onSiteCount: [
    { $match: countMatch },
    onSiteVisitLookup,
    { $match: { $expr: { $gt: [{ $size: "$_onSite" }, 0] } } },
    { $count: "count" },
  ],
  offSiteCount: [
    { $match: countMatch },
    onSiteVisitLookup,
    { $match: { $expr: { $eq: [{ $size: "$_onSite" }, 0] } } },
    { $count: "count" },
  ],
});

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
  onSiteVisitLookup,
  userAccountLookup,
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
  shapeUserAccount,
  {
    $project: {
      _branch: 0,
      _department: 0,
      _onSite: 0,
      _user: 0,
    },
  },
];

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const siteStatusLabel = (status) => {
  if (status === "onSite") return "On site";
  if (status === "offSite") return "Off site";
  return "";
};

const peopleToCsv = (rows) => {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.name),
        csvCell(row.email),
        csvCell(row.phone),
        csvCell(row.type),
        csvCell(row.branch?.name),
        csvCell(row.department?.name),
        csvCell(siteStatusLabel(row.siteStatus)),
        csvCell(row.carRegistration),
      ].join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
};

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
  hasAccount,
  keyword,
  format,
}) => {
  const exportFormat = format ? String(format).trim().toLowerCase() : "";
  if (exportFormat && exportFormat !== "csv") {
    throw new AppError("invalid_export_format", 400);
  }
  const isCsv = exportFormat === "csv";

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
    if (isCsv) {
      return { csv: peopleToCsv([]), fileName: "directory.csv" };
    }
    return {
      data: [],
      meta: {
        ...generateMeta(page, limit, 0),
        counts: { all: 0, onSite: 0, offSite: 0 },
      },
    };
  }

  const match = {
    branchId: { $in: branchIds },
    type: { $in: parseDirectoryTypes(type) },
  };
  if (departmentId) match.departmentId = toOid(departmentId, "invalid_object_ids");

  const or = keywordOr(keyword, ["name", "email", "phone"], { trim: true });
  if (or) match.$or = or;

  const countMatch = { ...match };
  const statusFilter = parseSiteStatus(siteStatus);
  const accountFilter = parseHasAccount(hasAccount);
  const afterStatus = [
    ...(statusFilter ? [{ $match: { siteStatus: statusFilter } }] : []),
    ...(accountFilter == null ? [] : [{ $match: { hasAccount: accountFilter } }]),
  ];
  const dataPipeline = [
    { $match: match },
    ...directoryLookups,
    ...afterStatus,
    { $sort: { createdAt: -1 } },
    { $skip: isCsv ? 0 : skip },
    { $limit: isCsv ? CSV_EXPORT_LIMIT : limit },
  ];

  if (isCsv) {
    const rows = await ExternalPerson.aggregate(dataPipeline);
    return { csv: peopleToCsv(rows), fileName: "directory.csv" };
  }

  const [result] = await ExternalPerson.aggregate([
    {
      $facet: {
        data: dataPipeline,
        totalCount: [
          { $match: match },
          ...directoryLookups,
          ...afterStatus,
          { $count: "count" },
        ],
        ...allCountFacet(countMatch),
        ...siteStatusCountFacets(countMatch),
      },
    },
  ]);

  return {
    data: result?.data || [],
    meta: {
      ...generateMeta(page, limit, facetCount(result?.totalCount)),
      counts: {
        all: facetCount(result?.allCount),
        onSite: facetCount(result?.onSiteCount),
        offSite: facetCount(result?.offSiteCount),
      },
    },
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
  if (scoped && String(scoped) !== String(person.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }

  const user = person.userId
    ? await User.findById(person.userId)
        .select("name email phoneNumber profileIcon accountState.status accountState.userType")
        .lean()
    : null;

  return {
    ...person,
    hasAccount: Boolean(user),
    user: user
      ? {
          _id: user._id,
          name: user.name || "",
          email: user.email || "",
          phoneNumber: user.phoneNumber || "",
          profileIcon: user.profileIcon || "",
          status: user.accountState?.status || "active",
          userType: user.accountState?.userType || "user",
          active: (user.accountState?.status || "active") === "active",
        }
      : null,
  };
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
  if (email !== undefined) {
    const nextEmail = normalizeVisitorEmail(email);
    if (nextEmail && nextEmail !== person.email) {
      const clash = await findPersonByBranchEmail({
        branchId: person.branchId,
        email: nextEmail,
      });
      if (clash && String(clash._id) !== String(person._id)) {
        throw new AppError("duplicate_external_person_email", 409);
      }
    }
    update.email = nextEmail;
  }
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

const presentVisitorAccount = (user) => {
  const status = user.accountState?.status || "active";
  const userId = user._id;
  return {
    userId,
    hasAccount: true,
    status,
    active: status === "active",
    user: {
      _id: userId,
      name: user.name || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      profileIcon: user.profileIcon || "",
      status,
      userType: user.accountState?.userType || "user",
      active: status === "active",
    },
  };
};

const updateVisitorUserAccount = async ({ actor, organizationId, userId }) => {
  const userOid = toOid(userId, "invalid_user_id");
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, null);

  const user = await User.findById(userOid).select(
    "name email phoneNumber profileIcon accountState"
  );
  if (!user) throw new AppError("user_not", 404);

  let branchFilter;
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchFilter = toOid(scopedBranchId, "invalid_branch_id");
  } else {
    const branches = await Branch.find({ organizationId: orgOid })
      .select("_id")
      .lean();
    branchFilter = { $in: branches.map((row) => row._id) };
  }

  const visitorLink = await ExternalPerson.exists({
    userId: userOid,
    branchId: branchFilter,
  });
  if (!visitorLink) throw new AppError("visitor_account_not_in_organization", 404);

  const staffMembership = await Membership.exists({ userId: userOid });
  if (staffMembership) throw new AppError("cannot_deactivate_staff_user", 409);

  const current = user.accountState?.status || "active";
  if (current !== "active" && current !== "inactive") {
    throw new AppError("account_status_not_toggleable", 409);
  }

  user.accountState.status = current === "active" ? "inactive" : "active";
  await user.save();
  userCache.del(String(user._id));

  return presentVisitorAccount(user);
};

module.exports = {
  DIRECTORY_TYPES,
  parsePersonType,
  normalizeVisitorEmail,
  toPersonObject,
  findPersonByBranchEmail,
  resolveExternalPersonAtBranch,
  createExternalPersonAtBranch,
  createExternalPerson,
  listExternalPeople,
  getExternalPerson,
  updateExternalPerson,
  updateVisitorUserAccount,
};
