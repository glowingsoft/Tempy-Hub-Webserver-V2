const mongoose = require("mongoose");
const { Requirement } = require("@models/Requirement");
const { RequirementAssignment } = require("@models/RequirementAssignment");
const { RequirementRecord } = require("@models/RequirementRecord");
const { StaffProfile } = require("@models/StaffProfile");
const { Membership } = require("@models/Membership");
const { Organization } = require("@models/Organization");
const { JobTitle } = require("@models/JobTitle");
const { Department } = require("@models/Department");
const { User } = require("@models/UserModel");
const { AppError } = require("@services/_errors/AppError");
const { paginateWithFacet } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { toPublicImageUrl } = require("@utils/imageHelper");
const {
  RequirementType,
  RequirementAssignmentSource,
  RequirementCellStatus,
  StaffProfileStatus,
  MembershipRole,
  ActiveInactiveStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertMaySuperviseStaff,
  assertBranchInOrganization,
  resolveScopedSuperviseeIds,
  scopeBranchFilter,
  MANAGER_ROLES,
} = require("@adminServices/staff/staffAccess");
const {
  addDays,
  addMonths,
  assignmentSourceFor,
  cellFromDates,
  trainingListStatus,
} = require("./requirementDates");

const TYPES = new Set(Object.values(RequirementType));
const LIST_STATUSES = new Set(["in_progress", "completed", "expired"]);

const toOid = (value, key) => {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new AppError(key, 400);
  return new mongoose.Types.ObjectId(String(value));
};

const optionalOid = (value, key) => {
  if (value == null || value === "") return null;
  return toOid(value, key);
};

const oidList = (value, key) => {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((id) => String(toOid(id, key))))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
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

const shapeFiles = (documents = []) =>
  documents.map((file) => {
    const raw = typeof file?.toObject === "function" ? file.toObject() : file;
    const key = String(raw?.key || "").trim();
    return {
      key,
      originalName: raw?.originalName || "",
      mimeType: raw?.mimeType || "",
      sizeBytes: raw?.sizeBytes || 0,
      url: toPublicImageUrl(key),
    };
  });

const positiveInt = (value, key, { required = false, min = 1 } = {}) => {
  if (value == null || value === "") {
    if (required) throw new AppError(key, 400);
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) throw new AppError(key, 400);
  return number;
};

const orgAmberDays = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("settings.amberDays")
    .lean();
  return organization?.settings?.amberDays ?? null;
};

const assertLibraryManager = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  if (!MANAGER_ROLES.includes(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }
  if (branchId) await assertBranchInOrganization(branchId, organizationId);
  if (standing.role === MembershipRole.SITE_MANAGER) {
    const scoped = scopeBranchFilter(standing, branchId);
    if (!scoped) throw new AppError("outside_managed_branch", 403);
    assertMayManageStaff(standing, scoped);
    return { standing, branchId: scoped };
  }
  assertMayManageStaff(standing, branchId || standing.branchId);
  return { standing, branchId: branchId || null };
};

const assertCanAccessStaff = async ({ actor, organizationId, staff }) => {
  const standing = await actorStanding(actor, organizationId);
  if (standing.role === MembershipRole.STAFF) {
    throw new AppError("insufficient_role", 403);
  }
  await assertMaySuperviseStaff({
    standing,
    actor,
    organizationId,
    branchId: staff.branchId,
    targetStaffId: staff._id,
  });
  return standing;
};

const requirementBranchFilter = (standing, branchId) => {
  const scoped = scopeBranchFilter(standing, branchId);
  if (standing.role === MembershipRole.SITE_MANAGER && standing.branchId) {
    return {
      $or: [{ branchId: standing.branchId }, { branchId: null }],
    };
  }
  if (scoped) return { branchId: scoped };
  return {};
};

const loadRequirement = async (requirementId, organizationId) => {
  const requirement = await Requirement.findOne({
    _id: requirementId,
    organizationId,
  }).lean();
  if (!requirement) throw new AppError("requirement_not_found", 404);
  return requirement;
};

const actorStaffProfileId = async (actor, organizationId) => {
  const profile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
  })
    .select("_id")
    .lean();
  return profile?._id || null;
};

/** Staff only see their own profile. A staffId query must match that profile. */
const staffIdsForRequirementList = async ({
  standing,
  actor,
  organizationId,
  staffId,
  branchId,
}) => {
  let scopedStaffId = staffId;
  if (standing.role === MembershipRole.STAFF) {
    const mine = await actorStaffProfileId(actor, organizationId);
    if (!mine) return [];
    if (staffId && String(staffId) !== String(mine)) return [];
    scopedStaffId = mine;
  }
  return resolveScopedSuperviseeIds({
    standing,
    actor,
    organizationId,
    staffId: scopedStaffId,
    branchId,
  });
};

const withActiveMembership = async (organizationId, staffIds) => {
  if (!staffIds.length) return [];
  const profiles = await StaffProfile.find({
    _id: { $in: staffIds },
    organizationId,
  })
    .select("_id userId")
    .lean();
  if (!profiles.length) return [];
  const activeUserIds = await Membership.find({
    organizationId,
    userId: { $in: profiles.map((row) => row.userId) },
    status: ActiveInactiveStatus.ACTIVE,
  }).distinct("userId");
  const active = new Set(activeUserIds.map(String));
  return profiles.filter((row) => active.has(String(row.userId))).map((row) => row._id);
};

const matchingStaff = async ({ organizationId, branchId, requirement }) => {
  const titles = requirement.appliesTo?.jobTitleIds || [];
  const departments = requirement.appliesTo?.departmentIds || [];
  if (!titles.length && !departments.length) return [];

  const match = {
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  };
  if (branchId) match.branchId = branchId;

  match.$or = [];
  if (titles.length) match.$or.push({ jobTitleId: { $in: titles } });
  if (departments.length) match.$or.push({ departmentIds: { $in: departments } });

  return StaffProfile.find(match)
    .select("_id branchId jobTitleId departmentIds")
    .lean();
};

const insertAssignments = async (docs) => {
  if (!docs.length) return 0;
  try {
    const created = await RequirementAssignment.insertMany(docs, { ordered: false });
    return created.length;
  } catch (error) {
    if (error?.code !== 11000 && !error?.writeErrors) throw error;
    return (error.result?.insertedCount || error.insertedDocs?.length || 0);
  }
};

const autoAssignRequirement = async ({
  organizationId,
  actorId,
  requirement,
}) => {
  const staff = await matchingStaff({
    organizationId,
    branchId: requirement.branchId,
    requirement,
  });
  const assignedAt = new Date();
  const docs = staff.map((row) => ({
    organizationId,
    branchId: row.branchId,
    staffId: row._id,
    requirementId: requirement._id,
    assignedAt,
    assignedBy: actorId,
    source: assignmentSourceFor(row, requirement),
    dueDate: addDays(assignedAt, requirement.firstCompletionDays),
    renewalMonthsOverride: null,
  }));
  return insertAssignments(docs);
};

const parseAppliesTo = (value) => ({
  jobTitleIds: oidList(value?.jobTitleIds, "invalid_job_title_id"),
  departmentIds: oidList(value?.departmentIds, "invalid_department_id"),
});

const listRequirements = async ({
  actor,
  organizationId,
  branchId,
  type,
  keyword,
  page,
  limit,
  skip,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  const match = {
    organizationId: orgOid,
    ...requirementBranchFilter(standing, optionalOid(branchId, "invalid_branch_id")),
  };
  const term = String(keyword || "").trim();
  if (term) match.name = { $regex: term, $options: "i" };

  const listMatch = { ...match };
  if (type) {
    if (!TYPES.has(type)) throw new AppError("invalid_requirement_type", 400);
    listMatch.type = type;
  }

  const [result] = await Requirement.aggregate([
    {
      $facet: {
        data: [
          { $match: listMatch },
          { $sort: { name: 1 } },
          { $skip: skip },
          { $limit: limit },
          ...appliesToLookups,
        ],
        totalCount: [{ $match: listMatch }, { $count: "count" }],
        typeCounts: [
          { $match: match },
          { $group: { _id: "$type", count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const typeCounts = Object.values(RequirementType).reduce((counts, value) => {
    counts[value] = 0;
    return counts;
  }, {});
  for (const row of result?.typeCounts || []) {
    if (row._id) typeCounts[row._id] = row.count;
  }

  return {
    data: result?.data || [],
    meta: {
      ...generateMeta(page, limit, result?.totalCount?.[0]?.count ?? 0),
      typeCounts,
    },
  };
};

const appliesToLookups = [
  {
    $lookup: {
      from: JobTitle.collection.name,
      localField: "appliesTo.jobTitleIds",
      foreignField: "_id",
      pipeline: [{ $project: { _id: 1, name: 1, branchId: 1, active: 1 } }],
      as: "jobTitles",
    },
  },
  {
    $lookup: {
      from: Department.collection.name,
      localField: "appliesTo.departmentIds",
      foreignField: "_id",
      pipeline: [{ $project: { _id: 1, name: 1, branchId: 1, active: 1 } }],
      as: "departments",
    },
  },
];

const getRequirement = async ({ actor, organizationId, requirementId, branchId }) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const reqOid = toOid(requirementId, "invalid_requirement_id");
  const standing = await actorStanding(actor, organizationId);
  const scopedBranch = optionalOid(branchId, "invalid_branch_id");

  const [requirement] = await Requirement.aggregate([
    {
      $match: {
        _id: reqOid,
        organizationId: orgOid,
        ...requirementBranchFilter(standing, scopedBranch),
      },
    },
    ...appliesToLookups,
    { $limit: 1 },
  ]);
  if (!requirement) throw new AppError("requirement_not_found", 404);

  const staffIds = await withActiveMembership(
    orgOid,
    await resolveScopedSuperviseeIds({
      standing,
      actor,
      organizationId,
      branchId: scopedBranch,
    })
  );

  let assignments = [];
  if (staffIds.length) {
    const match = {
      organizationId: orgOid,
      requirementId: reqOid,
      staffId: { $in: staffIds },
    };
    if (scopedBranch) match.branchId = scopedBranch;
    const rows = await RequirementAssignment.aggregate([
      { $match: match },
      { $sort: { assignedAt: -1 } },
      ...assignmentLookups,
    ]);
    const amberDays = await orgAmberDays(orgOid);
    assignments = rows.map((row) => shapeAssignmentRow(row, amberDays));
  }

  return { ...requirement, assignments };
};

const createRequirement = async ({
  actor,
  organizationId,
  branchId,
  name,
  type,
  renewalMonths,
  firstCompletionDays,
  amberDaysOverride,
  evidenceRequired,
  staffEvidenceAllowed,
  appliesTo,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const requestedBranch = optionalOid(branchId, "invalid_branch_id");
  const { branchId: scopedBranch } = await assertLibraryManager({
    actor,
    organizationId,
    branchId: requestedBranch,
  });

  const trimmed = String(name || "").trim();
  if (!trimmed) throw new AppError("requirement_name_required", 400);
  if (!TYPES.has(type)) throw new AppError("invalid_requirement_type", 400);

  const requirement = await Requirement.create({
    organizationId: orgOid,
    branchId: scopedBranch,
    name: trimmed,
    type,
    renewalMonths: positiveInt(renewalMonths, "invalid_renewal_months", {
      required: true,
    }),
    firstCompletionDays: positiveInt(
      firstCompletionDays,
      "invalid_first_completion_days",
      { required: true, min: 0 }
    ),
    amberDaysOverride: positiveInt(amberDaysOverride, "invalid_amber_days"),
    evidenceRequired: Boolean(evidenceRequired),
    staffEvidenceAllowed: Boolean(staffEvidenceAllowed),
    appliesTo: parseAppliesTo(appliesTo),
  });

  await autoAssignRequirement({
    organizationId: orgOid,
    actorId: actor._id,
    requirement: requirement.toObject(),
  });

  return requirement.toObject();
};

const updateRequirement = async ({
  actor,
  organizationId,
  requirementId,
  name,
  renewalMonths,
  firstCompletionDays,
  amberDaysOverride,
  evidenceRequired,
  staffEvidenceAllowed,
  appliesTo,
  branchId,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const requirement = await loadRequirement(
    toOid(requirementId, "invalid_requirement_id"),
    orgOid
  );
  await assertLibraryManager({
    actor,
    organizationId,
    branchId: requirement.branchId,
  });

  const $set = {};
  if (name != null) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new AppError("requirement_name_required", 400);
    $set.name = trimmed;
  }
  if (renewalMonths != null) {
    $set.renewalMonths = positiveInt(renewalMonths, "invalid_renewal_months", {
      required: true,
    });
  }
  if (firstCompletionDays != null) {
    $set.firstCompletionDays = positiveInt(
      firstCompletionDays,
      "invalid_first_completion_days",
      { required: true, min: 0 }
    );
  }
  if (amberDaysOverride !== undefined) {
    $set.amberDaysOverride = positiveInt(amberDaysOverride, "invalid_amber_days");
  }
  if (evidenceRequired != null) $set.evidenceRequired = Boolean(evidenceRequired);
  if (staffEvidenceAllowed != null) {
    $set.staffEvidenceAllowed = Boolean(staffEvidenceAllowed);
  }
  if (appliesTo != null) $set.appliesTo = parseAppliesTo(appliesTo);
  if (branchId !== undefined) {
    const nextBranch = optionalOid(branchId, "invalid_branch_id");
    const { branchId: scopedBranch } = await assertLibraryManager({
      actor,
      organizationId,
      branchId: nextBranch,
    });
    $set.branchId = scopedBranch;
  }

  const updated = await Requirement.findOneAndUpdate(
    { _id: requirement._id, organizationId: orgOid },
    { $set },
    { new: true }
  ).lean();

  await autoAssignRequirement({
    organizationId: orgOid,
    actorId: actor._id,
    requirement: updated,
  });
  return updated;
};

const createAssignments = async ({
  actor,
  organizationId,
  requirementId,
  staffIds,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const requirement = await loadRequirement(
    toOid(requirementId, "invalid_requirement_id"),
    orgOid
  );
  const ids = oidList(staffIds, "invalid_staff_profile_id");
  if (!ids.length) throw new AppError("staff_ids_required", 400);

  const staff = await StaffProfile.find({
    _id: { $in: ids },
    organizationId: orgOid,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (staff.length !== ids.length) throw new AppError("staff_profile_not_found", 404);

  for (const row of staff) {
    await assertCanAccessStaff({ actor, organizationId, staff: row });
  }

  const assignedAt = new Date();
  await insertAssignments(
    staff.map((row) => ({
      organizationId: orgOid,
      branchId: row.branchId,
      staffId: row._id,
      requirementId: requirement._id,
      assignedAt,
      assignedBy: actor._id,
      source: RequirementAssignmentSource.MANUAL,
      dueDate: addDays(assignedAt, requirement.firstCompletionDays),
      renewalMonthsOverride: null,
    }))
  );

  const assignments = await RequirementAssignment.find({
    organizationId: orgOid,
    requirementId: requirement._id,
    staffId: { $in: ids },
  }).lean();

  return {
    requirementId: requirement._id,
    createdCount: assignments.length,
    assignments: assignments.map((row) => ({
      ...row,
      assignmentId: row._id,
    })),
  };
};

const loadAssignment = async (assignmentId, organizationId) => {
  const assignment = await RequirementAssignment.findOne({
    _id: assignmentId,
    organizationId,
  }).lean();
  if (!assignment) throw new AppError("assignment_not_found", 404);
  return assignment;
};

const getAssignment = async ({ actor, organizationId, assignmentId }) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const assignmentOid = toOid(assignmentId, "invalid_assignment_id");
  const [assignment] = await RequirementAssignment.aggregate([
    { $match: { _id: assignmentOid, organizationId: orgOid } },
    {
      $lookup: {
        from: Requirement.collection.name,
        localField: "requirementId",
        foreignField: "_id",
        as: "requirement",
      },
    },
    { $unwind: { path: "$requirement", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: StaffProfile.collection.name,
        localField: "staffId",
        foreignField: "_id",
        pipeline: staffLookups,
        as: "staff",
      },
    },
    { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: RequirementRecord.collection.name,
        localField: "_id",
        foreignField: "assignmentId",
        pipeline: [{ $sort: { completedAt: -1 } }],
        as: "records",
      },
    },
  ]);
  if (!assignment) throw new AppError("assignment_not_found", 404);
  await assertCanAccessStaff({ actor, organizationId, staff: assignment.staff });

  const amberDays = await orgAmberDays(orgOid);
  const { staff, records, ...rest } = assignment;
  const cell = cellFromDates({
    assignment,
    latest: records?.[0] || null,
    requirement: assignment.requirement,
    orgAmberDays: amberDays,
  });

  return {
    ...rest,
    staff: staff ? shapeStaff(staff) : null,
    records: (records || []).map((row) => ({
      ...row,
      documents: shapeFiles(row.documents),
    })),
    status: cell.status,
    dueDate: cell.dueDate,
    completedAt: cell.completedAt,
    expiresAt: cell.expiresAt,
  };
};

const updateAssignment = async ({
  actor,
  organizationId,
  assignmentId,
  dueDate,
  renewalMonthsOverride,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const assignment = await loadAssignment(
    toOid(assignmentId, "invalid_assignment_id"),
    orgOid
  );
  const staff = await StaffProfile.findById(assignment.staffId)
    .select("branchId")
    .lean();
  await assertCanAccessStaff({ actor, organizationId, staff });

  const $set = {};
  if (dueDate != null) {
    const parsed = new Date(dueDate);
    if (Number.isNaN(parsed.getTime())) throw new AppError("invalid_due_date", 400);
    $set.dueDate = parsed;
  }
  if (renewalMonthsOverride !== undefined) {
    $set.renewalMonthsOverride = positiveInt(
      renewalMonthsOverride,
      "invalid_renewal_months"
    );
  }

  return RequirementAssignment.findOneAndUpdate(
    { _id: assignment._id },
    { $set },
    { new: true }
  ).lean();
};

const deleteAssignment = async ({ actor, organizationId, assignmentId }) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const assignment = await loadAssignment(
    toOid(assignmentId, "invalid_assignment_id"),
    orgOid
  );
  const staff = await StaffProfile.findById(assignment.staffId)
    .select("branchId")
    .lean();
  await assertCanAccessStaff({ actor, organizationId, staff });

  await RequirementRecord.deleteMany({ assignmentId: assignment._id });
  await RequirementAssignment.deleteOne({ _id: assignment._id });
  return { deleted: true };
};

const createRecord = async ({
  actor,
  organizationId,
  assignmentId,
  completedAt,
  notes,
  documents,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const assignment = await loadAssignment(
    toOid(assignmentId, "invalid_assignment_id"),
    orgOid
  );
  const staff = await StaffProfile.findById(assignment.staffId).lean();
  await assertCanAccessStaff({ actor, organizationId, staff });
  const requirement = await loadRequirement(assignment.requirementId, orgOid);

  const completed = completedAt ? new Date(completedAt) : new Date();
  if (Number.isNaN(completed.getTime())) throw new AppError("invalid_completed_at", 400);

  const months =
    assignment.renewalMonthsOverride != null
      ? assignment.renewalMonthsOverride
      : requirement.renewalMonths;
  const files = Array.isArray(documents) ? documents.map(parseStoredFile) : [];
  if (requirement.evidenceRequired && !files.length) {
    throw new AppError("document_file_required", 400);
  }

  const record = await RequirementRecord.create({
    organizationId: orgOid,
    branchId: assignment.branchId,
    assignmentId: assignment._id,
    staffId: assignment.staffId,
    requirementId: assignment.requirementId,
    completedAt: completed,
    expiresAt: addMonths(completed, months),
    documents: files,
    signedOffBy: actor._id,
    notes: String(notes || "").trim(),
  });

  const plain = record.toObject();
  return { ...plain, documents: shapeFiles(plain.documents) };
};

const latestByAssignment = async (assignmentIds) => {
  if (!assignmentIds.length) return new Map();
  const rows = await RequirementRecord.aggregate([
    { $match: { assignmentId: { $in: assignmentIds } } },
    { $sort: { completedAt: -1 } },
    { $group: { _id: "$assignmentId", latest: { $first: "$$ROOT" } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.latest]));
};

const staffLookups = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "userId",
      foreignField: "_id",
      pipeline: [
        { $project: { name: 1, email: 1, profileIcon: 1 } },
        { $limit: 1 },
      ],
      as: "_user",
    },
  },
  {
    $lookup: {
      from: JobTitle.collection.name,
      localField: "jobTitleId",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
      as: "_jobTitle",
    },
  },
  {
    $addFields: {
      name: { $ifNull: [{ $arrayElemAt: ["$_user.name", 0] }, ""] },
      email: { $ifNull: [{ $arrayElemAt: ["$_user.email", 0] }, ""] },
      image: { $ifNull: [{ $arrayElemAt: ["$_user.profileIcon", 0] }, ""] },
      jobTitle: { $arrayElemAt: ["$_jobTitle", 0] },
    },
  },
  { $project: { _user: 0, _jobTitle: 0, pinHash: 0 } },
];

const shapeStaff = (row) => ({
  _id: row._id,
  name: row.name || "",
  email: row.email || "",
  photoUrl: toPublicImageUrl(row.photoUrl || row.image),
  jobTitleId: row.jobTitleId,
  jobTitle: row.jobTitle || null,
  departmentIds: row.departmentIds || [],
  branchId: row.branchId,
});

const assignmentLookups = [
  {
    $lookup: {
      from: Requirement.collection.name,
      localField: "requirementId",
      foreignField: "_id",
      pipeline: [
        {
          $project: {
            name: 1,
            type: 1,
            renewalMonths: 1,
            firstCompletionDays: 1,
            amberDaysOverride: 1,
            createdAt: 1,
          },
        },
        { $limit: 1 },
      ],
      as: "requirement",
    },
  },
  { $unwind: { path: "$requirement", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: StaffProfile.collection.name,
      localField: "staffId",
      foreignField: "_id",
      pipeline: staffLookups,
      as: "staff",
    },
  },
  { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: RequirementRecord.collection.name,
      let: { assignmentId: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$assignmentId", "$$assignmentId"] } } },
        { $sort: { completedAt: -1 } },
        { $limit: 1 },
      ],
      as: "_latest",
    },
  },
  {
    $addFields: {
      latest: { $arrayElemAt: ["$_latest", 0] },
    },
  },
  { $project: { _latest: 0 } },
];

const shapeAssignmentRow = (row, amberDays) => {
  const cell = cellFromDates({
    assignment: row,
    latest: row.latest || null,
    requirement: row.requirement,
    orgAmberDays: amberDays,
  });
  return {
    _id: row._id,
    assignmentId: row._id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    staffId: row.staffId,
    requirementId: row.requirementId,
    assignedAt: row.assignedAt,
    assignedBy: row.assignedBy,
    source: row.source,
    renewalMonthsOverride: row.renewalMonthsOverride,
    staff: row.staff ? shapeStaff(row.staff) : null,
    requirement: row.requirement
      ? {
          _id: row.requirement._id,
          name: row.requirement.name,
          type: row.requirement.type,
        }
      : null,
    dueDate: cell.dueDate,
    completedAt: cell.completedAt,
    expiresAt: cell.expiresAt,
    status: trainingListStatus(cell),
    cellStatus: cell.status,
    record: row.latest
      ? {
          _id: row.latest._id,
          completedAt: row.latest.completedAt,
          expiresAt: row.latest.expiresAt,
          notes: row.latest.notes || "",
          signedOffBy: row.latest.signedOffBy,
          documents: shapeFiles(row.latest.documents || []),
        }
      : null,
  };
};

const competencyMatrix = async ({
  actor,
  organizationId,
  branchId,
  staffId,
  jobTitleId,
  departmentId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  const ids = await withActiveMembership(
    orgOid,
    await staffIdsForRequirementList({
      standing,
      actor,
      organizationId,
      staffId: optionalOid(staffId, "invalid_staff_profile_id"),
      branchId,
    })
  );
  if (!ids.length) {
    return {
      data: [],
      columns: [],
      meta: { ...generateMeta(page, limit, 0), stats: { courses: [], departments: [] } },
    };
  }

  const match = {
    _id: { $in: ids },
    organizationId: orgOid,
    status: { $ne: StaffProfileStatus.INACTIVE },
  };
  if (jobTitleId) match.jobTitleId = toOid(jobTitleId, "invalid_job_title_id");
  if (departmentId) {
    match.departmentIds = toOid(departmentId, "invalid_department_id");
  }
  const term = String(keyword || "").trim();

  let namedIds = ids;
  if (term) {
    const users = await User.find({ name: { $regex: term, $options: "i" } })
      .select("_id")
      .lean();
    const userIds = users.map((row) => row._id);
    namedIds = await StaffProfile.find({
      _id: { $in: ids },
      $or: [{ userId: { $in: userIds } }, { employeeCode: { $regex: term, $options: "i" } }],
    }).distinct("_id");
    match._id = { $in: namedIds };
  }

  const { data, meta } = await paginateWithFacet({
    model: StaffProfile,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: staffLookups,
  });

  const requirementMatch = {
    organizationId: orgOid,
    type: RequirementType.COMPETENCY,
    ...requirementBranchFilter(standing, optionalOid(branchId, "invalid_branch_id")),
  };
  const requirements = await Requirement.find(requirementMatch).sort({ name: 1 }).lean();
  const amberDays = await orgAmberDays(orgOid);

  const pagedIds = data.map((row) => row._id);
  const assignments = pagedIds.length
    ? await RequirementAssignment.find({
        organizationId: orgOid,
        staffId: { $in: pagedIds },
        requirementId: { $in: requirements.map((row) => row._id) },
      }).lean()
    : [];
  const latest = await latestByAssignment(assignments.map((row) => row._id));
  const assignmentKey = (staff, requirement) =>
    `${String(staff)}:${String(requirement)}`;
  const assignmentMap = new Map(
    assignments.map((row) => [assignmentKey(row.staffId, row.requirementId), row])
  );

  const columns = requirements.map((row) => ({
    _id: row._id,
    name: row.name,
    renewalMonths: row.renewalMonths,
  }));

  const rows = data.map((staff) => {
    const cells = requirements.map((requirement) => {
      const assignment = assignmentMap.get(assignmentKey(staff._id, requirement._id));
      return cellFromDates({
        assignment,
        latest: assignment ? latest.get(String(assignment._id)) : null,
        requirement,
        orgAmberDays: amberDays,
      });
    });
    const expected = cells.filter((cell) => cell.expected).length;
    const done = cells.filter((cell) => cell.met).length;
    return {
      staff: shapeStaff(staff),
      score: {
        done,
        expected,
        percent: expected === 0 ? null : Math.min(100, Math.round((done / expected) * 100)),
      },
      cells,
    };
  });

  const statsStaff = await StaffProfile.find({
    _id: { $in: namedIds },
    organizationId: orgOid,
  })
    .select("departmentIds jobTitleId branchId")
    .lean();
  const allAssignments = statsStaff.length
    ? await RequirementAssignment.find({
        organizationId: orgOid,
        staffId: { $in: namedIds },
        requirementId: { $in: requirements.map((row) => row._id) },
      }).lean()
    : [];
  const allLatest = await latestByAssignment(allAssignments.map((row) => row._id));
  const allMap = new Map(
    allAssignments.map((row) => [assignmentKey(row.staffId, row.requirementId), row])
  );

  const courseStats = requirements.map((requirement) => {
    let done = 0;
    let expected = 0;
    for (const staff of statsStaff) {
      const assignment = allMap.get(assignmentKey(staff._id, requirement._id));
      const cell = cellFromDates({
        assignment,
        latest: assignment ? allLatest.get(String(assignment._id)) : null,
        requirement,
        orgAmberDays: amberDays,
      });
      if (cell.expected) expected += 1;
      if (cell.met) done += 1;
    }
    return {
      requirementId: requirement._id,
      name: requirement.name,
      done,
      expected,
      percent: expected === 0 ? null : Math.min(100, Math.round((done / expected) * 100)),
    };
  });

  const departmentStats = new Map();
  for (const staff of statsStaff) {
    const deptIds = staff.departmentIds?.length ? staff.departmentIds : [null];
    let done = 0;
    let expected = 0;
    for (const requirement of requirements) {
      const assignment = allMap.get(assignmentKey(staff._id, requirement._id));
      const cell = cellFromDates({
        assignment,
        latest: assignment ? allLatest.get(String(assignment._id)) : null,
        requirement,
        orgAmberDays: amberDays,
      });
      if (cell.expected) expected += 1;
      if (cell.met) done += 1;
    }
    for (const departmentIdValue of deptIds) {
      const key = departmentIdValue ? String(departmentIdValue) : "none";
      const current = departmentStats.get(key) || {
        departmentId: departmentIdValue,
        done: 0,
        expected: 0,
      };
      current.done += done;
      current.expected += expected;
      departmentStats.set(key, current);
    }
  }

  return {
    data: rows,
    columns,
    meta: {
      ...meta,
      stats: {
        courses: courseStats,
        departments: [...departmentStats.values()].map((row) => ({
          ...row,
          percent:
            row.expected === 0
              ? null
              : Math.min(100, Math.round((row.done / row.expected) * 100)),
        })),
      },
    },
  };
};

const listAssignments = async ({
  actor,
  organizationId,
  branchId,
  staffId,
  requirementId,
  type,
  keyword,
  page,
  limit,
  skip,
  applyLimit = true,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  const ids = await withActiveMembership(
    orgOid,
    await staffIdsForRequirementList({
      standing,
      actor,
      organizationId,
      staffId: optionalOid(staffId, "invalid_staff_profile_id"),
      branchId,
    })
  );
  if (!ids.length) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }

  const requirementMatch = {
    organizationId: orgOid,
    ...requirementBranchFilter(standing, optionalOid(branchId, "invalid_branch_id")),
  };
  if (type) {
    if (!TYPES.has(type)) throw new AppError("invalid_requirement_type", 400);
    requirementMatch.type = type;
  }
  if (requirementId) {
    requirementMatch._id = toOid(requirementId, "invalid_requirement_id");
  }

  const requirementIds = await Requirement.find(requirementMatch).distinct("_id");
  if (!requirementIds.length) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }

  const match = {
    organizationId: orgOid,
    staffId: { $in: ids },
    requirementId: { $in: requirementIds },
  };
  if (branchId) match.branchId = toOid(branchId, "invalid_branch_id");

  const term = String(keyword || "").trim();
  if (term) {
    const regex = { $regex: term, $options: "i" };
    const users = await User.find({ name: regex }).select("_id").lean();
    const namedStaffIds = await StaffProfile.find({
      _id: { $in: ids },
      $or: [
        { userId: { $in: users.map((row) => row._id) } },
        { employeeCode: regex },
      ],
    }).distinct("_id");
    const namedRequirementIds = await Requirement.find({
      _id: { $in: requirementIds },
      name: regex,
    }).distinct("_id");
    const or = [];
    if (namedStaffIds.length) or.push({ staffId: { $in: namedStaffIds } });
    if (namedRequirementIds.length) {
      or.push({ requirementId: { $in: namedRequirementIds } });
    }
    if (!or.length) return { data: [], meta: generateMeta(page, limit, 0) };
    match.$or = or;
  }

  const { data, meta } = await paginateWithFacet({
    model: RequirementAssignment,
    match,
    page,
    limit,
    skip,
    sort: { assignedAt: -1 },
    applyLimit,
    extraDataStages: assignmentLookups,
  });
  const amberDays = await orgAmberDays(orgOid);

  return {
    data: data.map((row) => shapeAssignmentRow(row, amberDays)),
    meta,
  };
};

const listTrainingRecords = async ({
  actor,
  organizationId,
  branchId,
  staffId,
  requirementId,
  type,
  status,
  keyword,
  page,
  limit,
  skip,
}) => {
  if (status && !LIST_STATUSES.has(status)) {
    throw new AppError("invalid_training_status", 400);
  }

  const { data } = await listAssignments({
    actor,
    organizationId,
    branchId,
    staffId,
    requirementId,
    type,
    keyword,
    page,
    limit,
    skip,
    applyLimit: false,
  });

  const statusCounts = Object.fromEntries([...LIST_STATUSES].map((value) => [value, 0]));
  for (const row of data) {
    if (statusCounts[row.status] != null) statusCounts[row.status] += 1;
  }

  const filtered = status ? data.filter((row) => row.status === status) : data;
  return {
    data: filtered.slice(skip, skip + limit),
    meta: {
      ...generateMeta(page, limit, filtered.length),
      statusCounts,
    },
  };
};

const MET_CELL = new Set([
  RequirementCellStatus.VALID,
  RequirementCellStatus.DUE_SOON,
]);

const scoreShapedAssignments = (items) => {
  const expected = items.length;
  const done = items.filter((row) => MET_CELL.has(row.cellStatus)).length;
  return {
    score:
      expected === 0 ? null : Math.min(100, Math.round((done / expected) * 100)),
    done,
    expected,
  };
};

const myRequirementAssignments = async ({
  actor,
  organizationId,
  type,
  status,
  page,
  limit,
  skip,
}) => {
  if (!TYPES.has(type)) throw new AppError("invalid_requirement_type", 400);
  const staffId = await actorStaffProfileId(actor, organizationId);
  if (!staffId) throw new AppError("staff_profile_not_found", 404);

  const listed =
    type === RequirementType.TRAINING
      ? await listTrainingRecords({
          actor,
          organizationId,
          staffId,
          type,
          status,
          page,
          limit,
          skip,
        })
      : await listAssignments({
          actor,
          organizationId,
          staffId,
          type,
          page,
          limit,
          skip,
        });

  const { data: allRows } = await listAssignments({
    actor,
    organizationId,
    staffId,
    type,
    page: 1,
    limit: 500,
    skip: 0,
    applyLimit: false,
  });

  return {
    data: listed.data,
    meta: {
      ...listed.meta,
      compliance: scoreShapedAssignments(allRows),
    },
  };
};

module.exports = {
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  createAssignments,
  listAssignments,
  getAssignment,
  updateAssignment,
  deleteAssignment,
  createRecord,
  competencyMatrix,
  listTrainingRecords,
  myRequirementAssignments,
};
