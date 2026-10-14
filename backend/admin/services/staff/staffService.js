const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { Department } = require("@models/Department");
const { JobTitle } = require("@models/JobTitle");
const { StaffProfile } = require("@models/StaffProfile");
const { Membership } = require("@models/Membership");
const { User } = require("@models/UserModel");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  JobTitleLevel,
  StaffProfileStatus,
  ActiveInactiveStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  duplicateKey,
  applyLineManagerStaffScope,
  resolveSubordinateStaffIds,
} = require("./staffAccess");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const organizationSummary = (organization) =>
  organization
    ? {
        _id: organization._id,
        name: organization.name,
        status: organization.status,
      }
    : null;

const branchSummary = (branch) =>
  branch
    ? {
        _id: branch._id,
        name: branch.name,
        code: branch.code,
        status: branch.status,
      }
    : null;

const formatScopedRow = (row, organizationById, branchById) => ({
  ...row,
  organization: organizationSummary(
    organizationById.get(String(row.organizationId))
  ),
  branch: row.branchId
    ? branchSummary(branchById.get(String(row.branchId)))
    : null,
});

const attachOrgAndBranchDetails = async (rows) => {
  if (!rows?.length) return rows;

  const organizationIds = [
    ...new Set(rows.map((row) => String(row.organizationId))),
  ];
  const branchIds = [
    ...new Set(
      rows.filter((row) => row.branchId).map((row) => String(row.branchId))
    ),
  ];

  const [organizations, branches] = await Promise.all([
    Organization.find({ _id: { $in: organizationIds } })
      .select("_id name status")
      .lean(),
    branchIds.length
      ? Branch.find({ _id: { $in: branchIds } })
          .select("_id name code status")
          .lean()
      : [],
  ]);

  const organizationById = new Map(
    organizations.map((organization) => [String(organization._id), organization])
  );
  const branchById = new Map(
    branches.map((branch) => [String(branch._id), branch])
  );

  return rows.map((row) => formatScopedRow(row, organizationById, branchById));
};

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("hex");

const randomEmployeeCode = async (organizationId) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `EMP-${Array.from(crypto.randomBytes(4))
      .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
      .join("")}`;
    const exists = await StaffProfile.exists({ organizationId, employeeCode: code });
    if (!exists) return code;
  }
  throw new AppError("employee_code_generation_failed", 500);
};

const assertOrganizationExists = async (organizationId) => {
  const organization = await Organization.exists({ _id: organizationId });
  if (!organization) throw new AppError("organization_not_found", 404);
};

const assertJobTitleInScope = async ({
  jobTitleId,
  organizationId,
  branchId,
}) => {
  const jobTitle = await JobTitle.findOne({
    _id: jobTitleId,
    organizationId,
    active: true,
  }).lean();

  if (!jobTitle) throw new AppError("job_title_not_found", 404);

  if (jobTitle.branchId && branchId && String(jobTitle.branchId) !== String(branchId)) {
    throw new AppError("job_title_not_in_branch", 400);
  }

  return jobTitle;
};

const assertDepartmentsInScope = async ({
  departmentIds = [],
  organizationId,
  branchId,
}) => {
  if (!departmentIds.length) return [];

  const unique = [...new Set(departmentIds.map(String))];
  const rows = await Department.find({
    _id: { $in: unique },
    organizationId,
    active: true,
  }).lean();

  if (rows.length !== unique.length) {
    throw new AppError("department_not_found", 404);
  }

  for (const row of rows) {
    if (row.branchId && branchId && String(row.branchId) !== String(branchId)) {
      throw new AppError("department_not_in_branch", 400);
    }
  }

  return unique;
};

/**
 * Validates job title, departments, and manager for an invite or manual profile.
 * Returns null when no employment fields were sent; otherwise a normalised payload.
 */
const validateEmploymentAssignment = async ({
  organizationId,
  branchId,
  jobTitleId,
  departmentIds,
  reportsToStaffId,
  startDate,
  employeeCode,
}) => {
  const hasExtra =
    (departmentIds && departmentIds.length) ||
    reportsToStaffId ||
    startDate ||
    employeeCode;

  if (!jobTitleId && !hasExtra) return null;

  if (!jobTitleId) throw new AppError("job_title_required", 400);
  if (!branchId) throw new AppError("branch_required_for_staff", 400);
  if (!startDate) throw new AppError("start_date_required", 400);

  await assertBranchInOrganization(branchId, organizationId);
  await assertJobTitleInScope({ jobTitleId, organizationId, branchId });
  const scopedDepartments = await assertDepartmentsInScope({
    departmentIds,
    organizationId,
    branchId,
  });

  if (reportsToStaffId) {
    const manager = await StaffProfile.findOne({
      _id: reportsToStaffId,
      organizationId,
      status: StaffProfileStatus.ACTIVE,
    }).lean();

    if (!manager) throw new AppError("manager_not_found", 404);
    if (String(manager.branchId) !== String(branchId)) {
      throw new AppError("manager_not_in_branch", 400);
    }
  }

  if (employeeCode) {
    const taken = await StaffProfile.exists({ organizationId, employeeCode });
    if (taken) throw new AppError("employee_code_taken", 409);
  }

  return {
    jobTitleId,
    branchId,
    departmentIds: scopedDepartments,
    reportsToStaffId: reportsToStaffId || null,
    startDate: new Date(startDate),
    employeeCode: employeeCode || null,
  };
};

/** Creates a profile row; skips quietly when this user already has one in the org. */
const insertStaffProfile = async ({
  userId,
  organizationId,
  branchId,
  jobTitleId,
  departmentIds,
  reportsToStaffId,
  startDate,
  employeeCode,
  contractedWeeklyHours,
  session,
}) => {
  const existsQuery = StaffProfile.exists({ userId, organizationId });
  if (session) existsQuery.session(session);
  if (await existsQuery) return null;

  const code = employeeCode || (await randomEmployeeCode(organizationId));

  try {
    const createArgs = [
      {
        userId,
        organizationId,
        branchId,
        employeeCode: code,
        jobTitleId,
        departmentIds: departmentIds || [],
        reportsToStaffId: reportsToStaffId || null,
        startDate,
        contractedWeeklyHours:
          contractedWeeklyHours == null ? 37.5 : Number(contractedWeeklyHours),
        qrToken: randomToken(),
        status: StaffProfileStatus.ACTIVE,
      },
    ];
    const options = session ? { session } : {};
    const [profile] = await StaffProfile.create(createArgs, options);
    return profile;
  } catch (error) {
    if (duplicateKey(error)) {
      if (error.keyPattern?.employeeCode) {
        throw new AppError("employee_code_taken", 409);
      }
      if (error.keyPattern?.userId) {
        return null;
      }
      if (error.keyPattern?.qrToken) {
        throw new AppError("staff_profile_creation_failed", 500);
      }
      if (error.keyPattern?.nfcTagId) {
        throw new AppError("nfc_tag_taken", 409);
      }
    }
    throw error;
  }
};

// --- Departments ---

const createDepartment = async ({
  actor,
  organizationId,
  name,
  branchId,
  sortOrder,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayManageStaff(standing, scopedBranchId);
  await assertOrganizationExists(organizationId);
  await assertBranchInOrganization(scopedBranchId, organizationId);

  try {
    const department = await Department.create({
      organizationId,
      branchId: scopedBranchId,
      name,
      sortOrder: sortOrder ?? 0,
    });
    const [withDetails] = await attachOrgAndBranchDetails([
      department.toObject(),
    ]);
    return withDetails;
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("department_name_taken", 409);
    throw error;
  }
};

const parseActiveInactiveFilter = (active, status) => {
  if (active !== undefined && active !== null && String(active) !== "") {
    if (active === true || active === "true" || active === "1") return true;
    if (active === false || active === "false" || active === "0") return false;
  }
  if (status === "active") return true;
  if (status === "inactive") return false;
  return null;
};

const activeInactiveCountFacets = (countMatch) => ({
  activeCount: [
    { $match: { ...countMatch, active: true } },
    { $count: "count" },
  ],
  inactiveCount: [
    { $match: { ...countMatch, active: false } },
    { $count: "count" },
  ],
});

const activeInactiveCountsFromFacet = (result) => ({
  active: facetCount(result.activeCount),
  inactive: facetCount(result.inactiveCount),
});

const listDepartments = async ({
  organizationId,
  page,
  limit,
  skip,
  keyword,
  branchId,
  active,
  status,
}) => {
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };

  if (branchId !== undefined) {
    match.branchId = branchId
      ? new mongoose.Types.ObjectId(String(branchId))
      : null;
  }

  const or = keywordOr(keyword, ["name"], { trim: true });
  if (or) match.$or = or;

  const countMatch = { ...match };
  const activeFilter = parseActiveInactiveFilter(active, status);
  if (activeFilter !== null) match.active = activeFilter;

  const { data, meta, result } = await paginateWithFacet({
    model: Department,
    match,
    page,
    limit,
    skip,
    sort: { sortOrder: 1, name: 1 },
    extraFacets: activeInactiveCountFacets(countMatch),
  });

  return {
    data: await attachOrgAndBranchDetails(data),
    meta: { ...meta, counts: activeInactiveCountsFromFacet(result) },
  };
};

const getDepartment = async ({ departmentId, organizationId }) => {
  const department = await Department.findOne({
    _id: departmentId,
    organizationId,
  }).lean();

  if (!department) throw new AppError("department_not_found", 404);
  const [withDetails] = await attachOrgAndBranchDetails([department]);
  return withDetails;
};

const updateDepartment = async ({
  actor,
  departmentId,
  organizationId,
  name,
  sortOrder,
  active,
}) => {
  const department = await Department.findOne({ _id: departmentId, organizationId });
  if (!department) throw new AppError("department_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, department.branchId);

  if (name !== undefined) department.name = name;
  if (sortOrder !== undefined) department.sortOrder = Number(sortOrder);
  if (active !== undefined) department.active = Boolean(active);

  if (!department.isModified()) throw new AppError("nothing_to_update", 400);

  try {
    await department.save();
    const [withDetails] = await attachOrgAndBranchDetails([
      department.toObject(),
    ]);
    return withDetails;
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("department_name_taken", 409);
    throw error;
  }
};

// --- Job titles ---

const createJobTitle = async ({
  actor,
  organizationId,
  name,
  branchId,
  level,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayManageStaff(standing, scopedBranchId);
  await assertOrganizationExists(organizationId);
  await assertBranchInOrganization(scopedBranchId, organizationId);

  if (level && !Object.values(JobTitleLevel).includes(level)) {
    throw new AppError("invalid_job_title_level", 400);
  }

  try {
    const jobTitle = await JobTitle.create({
      organizationId,
      branchId: scopedBranchId,
      name,
      level: level || JobTitleLevel.OPERATIONAL,
    });
    const [withDetails] = await attachOrgAndBranchDetails([jobTitle.toObject()]);
    return withDetails;
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("job_title_name_taken", 409);
    throw error;
  }
};

const listJobTitles = async ({
  organizationId,
  page,
  limit,
  skip,
  keyword,
  branchId,
  active,
  status,
  level,
}) => {
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };

  if (branchId !== undefined) {
    match.branchId = branchId
      ? new mongoose.Types.ObjectId(String(branchId))
      : null;
  }

  if (level) match.level = level;

  const or = keywordOr(keyword, ["name"], { trim: true });
  if (or) match.$or = or;

  const countMatch = { ...match };
  const activeFilter = parseActiveInactiveFilter(active, status);
  if (activeFilter !== null) match.active = activeFilter;

  const { data, meta, result } = await paginateWithFacet({
    model: JobTitle,
    match,
    page,
    limit,
    skip,
    sort: { name: 1 },
    extraFacets: activeInactiveCountFacets(countMatch),
  });

  return {
    data: await attachOrgAndBranchDetails(data),
    meta: { ...meta, counts: activeInactiveCountsFromFacet(result) },
  };
};

const getJobTitle = async ({ jobTitleId, organizationId }) => {
  const jobTitle = await JobTitle.findOne({
    _id: jobTitleId,
    organizationId,
  }).lean();

  if (!jobTitle) throw new AppError("job_title_not_found", 404);
  const [withDetails] = await attachOrgAndBranchDetails([jobTitle]);
  return withDetails;
};

const updateJobTitle = async ({
  actor,
  jobTitleId,
  organizationId,
  name,
  level,
  active,
}) => {
  const jobTitle = await JobTitle.findOne({ _id: jobTitleId, organizationId });
  if (!jobTitle) throw new AppError("job_title_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, jobTitle.branchId);

  if (name !== undefined) jobTitle.name = name;
  if (level !== undefined) {
    if (!Object.values(JobTitleLevel).includes(level)) {
      throw new AppError("invalid_job_title_level", 400);
    }
    jobTitle.level = level;
  }
  if (active !== undefined) jobTitle.active = Boolean(active);

  if (!jobTitle.isModified()) throw new AppError("nothing_to_update", 400);

  try {
    await jobTitle.save();
    const [withDetails] = await attachOrgAndBranchDetails([jobTitle.toObject()]);
    return withDetails;
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("job_title_name_taken", 409);
    throw error;
  }
};

// --- Staff profiles ---

const staffListStages = [
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "user",
    },
  },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "jobtitles",
      localField: "jobTitleId",
      foreignField: "_id",
      as: "jobTitle",
    },
  },
  { $unwind: { path: "$jobTitle", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      pinHash: 0,
      "user.password": 0,
      "user.resetToken": 0,
    },
  },
];

const createStaffProfile = async ({
  actor,
  organizationId,
  userId,
  branchId,
  employeeCode,
  jobTitleId,
  departmentIds,
  reportsToStaffId,
  startDate,
  contractedWeeklyHours,
  phone,
  photoUrl,
  bannerUrl,
  ward,
  locationLabel,
  pin,
  status,
}) => {
  if (!userId) throw new AppError("user_id_required", 400);
  if (!branchId) throw new AppError("branch_required_for_staff", 400);
  if (!jobTitleId) throw new AppError("job_title_required", 400);
  if (!startDate) throw new AppError("start_date_required", 400);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, branchId);
  await assertOrganizationExists(organizationId);
  await assertBranchInOrganization(branchId, organizationId);

  const user = await User.findById(userId).select("_id").lean();
  if (!user) throw new AppError("user_not", 404);

  const membership = await Membership.findOne({
    userId,
    organizationId,
    status: ActiveInactiveStatus.ACTIVE,
  }).lean();

  if (!membership) throw new AppError("no_membership_for_scope", 403);

  if (
    membership.branchId &&
    String(membership.branchId) !== String(branchId)
  ) {
    throw new AppError("membership_branch_mismatch", 400);
  }

  const existingProfile = await StaffProfile.exists({ userId, organizationId });
  if (existingProfile) throw new AppError("staff_profile_already_exists", 409);

  const employment = await validateEmploymentAssignment({
    organizationId,
    branchId,
    jobTitleId,
    departmentIds,
    reportsToStaffId,
    startDate,
    employeeCode,
  });

  if (status && !Object.values(StaffProfileStatus).includes(status)) {
    throw new AppError("invalid_staff_profile_status", 400);
  }

  let pinHash = "";
  if (pin !== undefined && pin !== null && String(pin) !== "") {
    if (!/^\d{4,8}$/.test(String(pin))) {
      throw new AppError("invalid_staff_pin", 400);
    }
    pinHash = await bcrypt.hash(String(pin), 10);
  }

  try {
    const profile = await insertStaffProfile({
      userId,
      organizationId,
      branchId,
      jobTitleId: employment.jobTitleId,
      departmentIds: employment.departmentIds,
      reportsToStaffId: employment.reportsToStaffId,
      startDate: employment.startDate,
      employeeCode: employment.employeeCode,
      contractedWeeklyHours,
    });

    if (pinHash || phone || photoUrl || bannerUrl || ward || locationLabel || status) {
      if (pinHash) profile.pinHash = pinHash;
      if (phone) profile.phone = phone;
      if (photoUrl) profile.photoUrl = photoUrl;
      if (bannerUrl) profile.bannerUrl = bannerUrl;
      if (ward) profile.ward = ward;
      if (locationLabel) profile.locationLabel = locationLabel;
      if (status) profile.status = status;
      await profile.save();
    }

    const populated = await StaffProfile.findById(profile._id)
      .select("-pinHash")
      .populate("userId", "name email")
      .populate("jobTitleId", "name level")
      .populate("departmentIds", "name")
      .lean();

    return populated;
  } catch (error) {
    if (duplicateKey(error)) {
      if (error.keyPattern?.employeeCode) {
        throw new AppError("employee_code_taken", 409);
      }
      if (error.keyPattern?.userId) {
        throw new AppError("staff_profile_already_exists", 409);
      }
      if (error.keyPattern?.qrToken) {
        throw new AppError("staff_profile_creation_failed", 500);
      }
      if (error.keyPattern?.nfcTagId) {
        throw new AppError("nfc_tag_taken", 409);
      }
    }
    throw error;
  }
};

const listStaffProfiles = async ({
  organizationId,
  page,
  limit,
  skip,
  keyword,
  branchId,
  departmentId,
  jobTitleId,
  status,
  actor,
}) => {
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };

  if (actor) {
    const standing = await actorStanding(actor, organizationId);
    const scopedBranchId = scopeBranchFilter(standing, branchId);
    if (scopedBranchId) {
      match.branchId = new mongoose.Types.ObjectId(String(scopedBranchId));
    } else if (branchId) {
      match.branchId = new mongoose.Types.ObjectId(String(branchId));
    }

    const inScope = await applyLineManagerStaffScope({
      match,
      standing,
      actor,
      organizationId,
      staffIdField: "_id",
    });
    if (!inScope) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }
  } else if (branchId) {
    match.branchId = new mongoose.Types.ObjectId(String(branchId));
  }

  if (departmentId) {
    match.departmentIds = new mongoose.Types.ObjectId(String(departmentId));
  }

  if (jobTitleId) {
    match.jobTitleId = new mongoose.Types.ObjectId(String(jobTitleId));
  }

  if (status) match.status = status;

  if (keyword && String(keyword).trim()) {
    const trimmed = String(keyword).trim();
    const users = await User.find({
      $or: [
        { name: { $regex: trimmed, $options: "i" } },
        { email: { $regex: trimmed, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();

    match.$or = [
      { employeeCode: { $regex: trimmed, $options: "i" } },
      { userId: { $in: users.map((u) => u._id) } },
    ];
  }

  return paginateWithFacet({
    model: StaffProfile,
    match,
    page,
    limit,
    skip,
    extraDataStages: staffListStages,
  });
};

/** Live team list for the caller — direct reports only, never cached. */
const listDirectReports = async ({ actor, organizationId }) => {
  const ids = await resolveSubordinateStaffIds({
    userId: actor._id,
    organizationId,
  });

  if (!ids.length) return [];

  return StaffProfile.find({
    _id: { $in: ids },
    organizationId,
  })
    .select("-pinHash")
    .populate("userId", "name email")
    .populate("jobTitleId", "name level")
    .populate("departmentIds", "name")
    .lean();
};

const getStaffProfile = async ({ staffProfileId, organizationId }) => {
  const profile = await StaffProfile.findOne({
    _id: staffProfileId,
    organizationId,
  })
    .select("-pinHash")
    .populate("userId", "name email")
    .populate("jobTitleId", "name level")
    .populate("departmentIds", "name")
    .populate("reportsToStaffId", "employeeCode userId")
    .lean();

  if (!profile) throw new AppError("staff_profile_not_found", 404);
  return profile;
};

const updateStaffProfile = async ({
  actor,
  staffProfileId,
  organizationId,
  branchId,
  employeeCode,
  jobTitleId,
  departmentIds,
  reportsToStaffId,
  startDate,
  contractedWeeklyHours,
  phone,
  photoUrl,
  bannerUrl,
  ward,
  locationLabel,
  pin,
  nfcTagId,
  status,
}) => {
  const profile = await StaffProfile.findOne({
    _id: staffProfileId,
    organizationId,
  });

  if (!profile) throw new AppError("staff_profile_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, profile.branchId);

  const targetBranchId = branchId ?? profile.branchId;

  if (branchId !== undefined) {
    await assertBranchInOrganization(branchId, organizationId);
    profile.branchId = branchId;
  }

  if (employeeCode !== undefined) {
    const taken = await StaffProfile.exists({
      organizationId,
      employeeCode,
      _id: { $ne: profile._id },
    });
    if (taken) throw new AppError("employee_code_taken", 409);
    profile.employeeCode = employeeCode;
  }

  if (jobTitleId !== undefined) {
    await assertJobTitleInScope({
      jobTitleId,
      organizationId,
      branchId: targetBranchId,
    });
    profile.jobTitleId = jobTitleId;
  }

  if (departmentIds !== undefined) {
    profile.departmentIds = await assertDepartmentsInScope({
      departmentIds,
      organizationId,
      branchId: targetBranchId,
    });
  }

  if (reportsToStaffId !== undefined) {
    if (!reportsToStaffId) {
      profile.reportsToStaffId = null;
    } else {
      if (String(reportsToStaffId) === String(profile._id)) {
        throw new AppError("cannot_report_to_self", 400);
      }
      const manager = await StaffProfile.findOne({
        _id: reportsToStaffId,
        organizationId,
        status: StaffProfileStatus.ACTIVE,
      }).lean();
      if (!manager) throw new AppError("manager_not_found", 404);
      if (String(manager.branchId) !== String(targetBranchId)) {
        throw new AppError("manager_not_in_branch", 400);
      }
      profile.reportsToStaffId = reportsToStaffId;
    }
  }

  if (startDate !== undefined) profile.startDate = new Date(startDate);
  if (contractedWeeklyHours !== undefined) {
    profile.contractedWeeklyHours = Number(contractedWeeklyHours);
  }
  if (phone !== undefined) profile.phone = phone;
  if (photoUrl !== undefined) profile.photoUrl = photoUrl;
  if (bannerUrl !== undefined) profile.bannerUrl = bannerUrl;
  if (ward !== undefined) profile.ward = ward;
  if (locationLabel !== undefined) profile.locationLabel = locationLabel;

  if (nfcTagId !== undefined) {
    const trimmed = nfcTagId == null ? "" : String(nfcTagId).trim();
    profile.nfcTagId = trimmed || undefined;
  }

  if (pin !== undefined) {
    if (!pin) {
      profile.pinHash = "";
    } else {
      if (!/^\d{4,8}$/.test(String(pin))) {
        throw new AppError("invalid_staff_pin", 400);
      }
      profile.pinHash = await bcrypt.hash(String(pin), 10);
    }
  }

  if (status !== undefined) {
    if (!Object.values(StaffProfileStatus).includes(status)) {
      throw new AppError("invalid_staff_profile_status", 400);
    }
    profile.status = status;
  }

  if (!profile.isModified()) throw new AppError("nothing_to_update", 400);

  try {
    await profile.save();
    return getStaffProfile({ staffProfileId: profile._id, organizationId });
  } catch (error) {
    if (duplicateKey(error)) {
      if (error.keyPattern?.employeeCode) {
        throw new AppError("employee_code_taken", 409);
      }
      if (error.keyPattern?.nfcTagId) {
        throw new AppError("nfc_tag_taken", 409);
      }
    }
    throw error;
  }
};

module.exports = {
  createDepartment,
  listDepartments,
  getDepartment,
  updateDepartment,
  createJobTitle,
  listJobTitles,
  getJobTitle,
  updateJobTitle,
  validateEmploymentAssignment,
  insertStaffProfile,
  createStaffProfile,
  listStaffProfiles,
  listDirectReports,
  getStaffProfile,
  updateStaffProfile,
};
