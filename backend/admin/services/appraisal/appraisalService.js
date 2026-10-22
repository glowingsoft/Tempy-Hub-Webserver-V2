const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Organization } = require("@models/Organization");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { AppraisalRecord } = require("@models/AppraisalRecord");
const { AppError } = require("@services/_errors/AppError");
const {
  AppraisalKind,
  ComplianceMeetingStatus,
  StaffProfileStatus,
  MembershipRole,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayApproveForStaff,
  assertMaySuperviseStaff,
  resolveScopedStaffIds,
  resolveScopedSuperviseeIds,
  MANAGER_ROLES,
} = require("../staff/staffAccess");
const { DEFAULT_TZ, inZone, supervisionStanding } = require("../supervision/supervisionSchedule");
const {
  loadOrgCycleSettings,
  effectiveIntervals,
} = require("./cycle");
const { updateStaffComplianceSettings } = require("../staff/complianceSettings");
const { actorConductor, conductedByStages } = require("../staff/meetingConductor");
const { paginateWithFacet } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const {
  MEETING_STATUSES,
  emptyStatusCounts,
  countAppraisalStatuses,
  appraisalRecordStages,
} = require("./appraisalRecordPipeline");

const toObjectId = (value, key) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const timezoneFor = async (branchId) => {
  const branch = await Branch.findById(branchId).select("timezone").lean();
  return branch?.timezone || DEFAULT_TZ;
};

const atZone = (value, timezone) => {
  const parsed = inZone(value, timezone);
  if (!parsed.isValid()) throw new AppError("invalid_appraisal_date", 400);
  return parsed.toDate();
};

const loadStaff = async (staffId, organizationId) => {
  const staff = await StaffProfile.findOne({
    _id: staffId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);
  return staff;
};

const uniqueIds = (ids) => {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
};

const scopedAppraisalStaffIds = async ({
  standing,
  actor,
  organizationId,
  staffId,
  branchId,
}) => {
  const [reports, supervisees] = await Promise.all([
    resolveScopedStaffIds({
      standing,
      actor,
      organizationId,
      staffId,
      branchId,
    }),
    resolveScopedSuperviseeIds({
      standing,
      actor,
      organizationId,
      staffId,
      branchId,
    }),
  ]);
  return uniqueIds([...reports, ...supervisees]);
};

const assertCanAccessStaff = async ({ actor, organizationId, staff }) => {
  const standing = await actorStanding(actor, organizationId);
  if (standing.role === MembershipRole.STAFF) {
    throw new AppError("insufficient_role", 403);
  }
  if (MANAGER_ROLES.includes(standing.role)) {
    await assertMayApproveForStaff({
      standing,
      actor,
      organizationId,
      branchId: staff.branchId,
      targetStaffId: staff._id,
    });
    return standing;
  }
  try {
    await assertMayApproveForStaff({
      standing,
      actor,
      organizationId,
      branchId: staff.branchId,
      targetStaffId: staff._id,
    });
  } catch (error) {
    if (error?.statusCode !== 403) throw error;
    await assertMaySuperviseStaff({
      standing,
      actor,
      organizationId,
      branchId: staff.branchId,
      targetStaffId: staff._id,
    });
  }
  return standing;
};

const assertCanWriteAppraisal = async ({ actor, organizationId, standing }) => {
  if (MANAGER_ROLES.includes(standing.role)) return;

  if (standing.role !== MembershipRole.LINE_MANAGER) {
    throw new AppError("insufficient_role", 403);
  }

  const [organization, profile] = await Promise.all([
    Organization.findById(organizationId)
      .select("settings.appraisalWriterStaffIds")
      .lean(),
    StaffProfile.findOne({ userId: actor._id, organizationId }).select("_id").lean(),
  ]);
  const writers = organization?.settings?.appraisalWriterStaffIds || [];
  const allowed =
    profile &&
    writers.some((id) => String(id) === String(profile._id));
  if (!allowed) throw new AppError("not_appraisal_writer", 403);
};

const assertWriterForStaff = async ({ actor, organizationId, staff }) => {
  const standing = await assertCanAccessStaff({ actor, organizationId, staff });
  await assertCanWriteAppraisal({ actor, organizationId, standing });
  return standing;
};

const updateAppraisalSettings = (payload) => updateStaffComplianceSettings(payload);

const standingMeetings = (meetings) =>
  meetings.filter(
    (meeting) =>
      meeting.status === ComplianceMeetingStatus.SCHEDULED ||
      (meeting.status === ComplianceMeetingStatus.COMPLETED &&
        meeting.kind !== AppraisalKind.OTHER)
  );

const parseMeetingStatus = (status) => {
  if (status == null || String(status).trim() === "" || String(status).trim() === "all") {
    return undefined;
  }
  const value = String(status).trim();
  if (!MEETING_STATUSES.includes(value)) {
    throw new AppError("invalid_appraisal_status", 400);
  }
  return value;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const staffIdsMatchingKeyword = async (staffIds, keyword) => {
  const term = String(keyword || "").trim();
  if (!term || !staffIds.length) return [];

  const regex = { $regex: escapeRegex(term), $options: "i" };
  const rows = await StaffProfile.aggregate([
    { $match: { _id: { $in: staffIds } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        pipeline: [
          { $match: { $or: [{ name: regex }, { email: regex }] } },
          { $project: { _id: 1 } },
        ],
        as: "user",
      },
    },
    {
      $match: {
        $or: [{ user: { $ne: [] } }, { employeeCode: regex }],
      },
    },
    { $project: { _id: 1 } },
  ]);

  return rows.map((row) => row._id);
};

const emptyPage = (page, limit) => ({
  data: [],
  meta: { ...generateMeta(page, limit, 0), counts: emptyStatusCounts() },
});

const listTeamAppraisals = async ({
  actor,
  organizationId,
  branchId,
  staffId,
  status,
  keyword,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const ids = await scopedAppraisalStaffIds({
    standing,
    actor,
    organizationId,
    staffId: staffId ? toObjectId(staffId, "invalid_staff_profile_id") : null,
    branchId,
  });
  if (!ids.length) return emptyPage(page, limit);

  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const match = {
    organizationId: orgOid,
    staffId: { $in: ids },
  };
  if (branchId) match.branchId = toObjectId(branchId, "invalid_branch_id");

  const term = String(keyword || "").trim();
  if (term) {
    const regex = { $regex: escapeRegex(term), $options: "i" };
    const namedStaffIds = await staffIdsMatchingKeyword(ids, term);
    match.$or = [
      ...(namedStaffIds.length ? [{ staffId: { $in: namedStaffIds } }] : []),
      { periodLabel: regex },
      { managerComments: regex },
      { goals: regex },
      { trainingNeeds: regex },
    ];
  }

  const meetingStatus = parseMeetingStatus(status);
  const countMatch = { ...match };
  if (meetingStatus) match.status = meetingStatus;

  const [{ data, meta }, counts] = await Promise.all([
    paginateWithFacet({
      model: AppraisalRecord,
      match,
      page,
      limit,
      skip,
      sort: { createdAt: -1 },
      extraDataStages: appraisalRecordStages,
    }),
    countAppraisalStatuses(countMatch),
  ]);

  return { data, meta: { ...meta, counts } };
};

const getAppraisal = async ({ actor, organizationId, appraisalId }) => {
  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const recordId = toObjectId(appraisalId, "invalid_appraisal_id");
  const [row] = await AppraisalRecord.aggregate([
    { $match: { _id: recordId, organizationId: orgOid } },
    ...appraisalRecordStages,
  ]);
  if (!row) throw new AppError("appraisal_not_found", 404);

  await assertCanAccessStaff({
    actor,
    organizationId,
    staff: { _id: row.staffId, branchId: row.branchId },
  });
  return row;
};

const textFrom = (value) => (value == null ? "" : String(value));

const actionPointsFrom = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AppError("invalid_action_points", 400);
  const points = [];
  for (const item of value) {
    const text = String(typeof item === "string" ? item : item?.text || "").trim();
    if (text) points.push({ text });
  }
  return points;
};

const fileFrom = (file) =>
  file?.url
    ? { name: file.name || "", fileType: file.fileType || "", url: file.url }
    : null;

const parseKind = (value) => {
  if (value == null || value === "") return AppraisalKind.ANNUAL;
  if (!Object.values(AppraisalKind).includes(value)) {
    throw new AppError("invalid_appraisal_kind", 400);
  }
  return value;
};

const parseAppraisalStatus = (status, completedAt) => {
  const appraisalStatus =
    status ||
    (completedAt ? ComplianceMeetingStatus.COMPLETED : ComplianceMeetingStatus.SCHEDULED);
  if (
    !Object.values(ComplianceMeetingStatus).includes(appraisalStatus) ||
    appraisalStatus === ComplianceMeetingStatus.CANCELLED
  ) {
    throw new AppError("invalid_appraisal_status", 400);
  }
  return appraisalStatus;
};

const createAppraisal = async ({
  actor,
  organizationId,
  staffId,
  kind,
  status,
  scheduledAt,
  periodLabel,
  completedAt,
  managerComments,
  goals,
  trainingNeeds,
  actionPoints,
  file,
}) => {
  const staff = await loadStaff(
    toObjectId(staffId, "invalid_staff_profile_id"),
    organizationId
  );
  const standing = await assertCanAccessStaff({ actor, organizationId, staff });
  const meetingStatus = parseAppraisalStatus(status, completedAt);
  if (meetingStatus === ComplianceMeetingStatus.COMPLETED) {
    await assertCanWriteAppraisal({ actor, organizationId, standing });
  }
  if (meetingStatus === ComplianceMeetingStatus.SCHEDULED && !scheduledAt) {
    throw new AppError("appraisal_schedule_required", 400);
  }

  const [timezone, conductor] = await Promise.all([
    timezoneFor(staff.branchId),
    actorConductor({ actor, organizationId }),
  ]);

  const record = await AppraisalRecord.create({
    organizationId,
    staffId: staff._id,
    branchId: staff.branchId,
    kind: parseKind(kind),
    periodLabel: periodLabel || "",
    scheduledAt: scheduledAt ? atZone(scheduledAt, timezone) : null,
    completedAt:
      meetingStatus === ComplianceMeetingStatus.COMPLETED
        ? completedAt
          ? atZone(completedAt, timezone)
          : moment.tz(timezone).toDate()
        : null,
    conductedByStaffId: conductor.conductedByStaffId,
    conductedByUserId: conductor.conductedByUserId,
    managerComments: textFrom(managerComments),
    goals: textFrom(goals),
    trainingNeeds: textFrom(trainingNeeds),
    actionPoints: actionPointsFrom(actionPoints),
    file: fileFrom(file),
    status: meetingStatus,
  });

  return record.toObject();
};

const loadAppraisal = async (appraisalId, organizationId) => {
  const record = await AppraisalRecord.findOne({
    _id: toObjectId(appraisalId, "invalid_appraisal_id"),
    organizationId: toObjectId(organizationId, "invalid_organization_id"),
  });
  if (!record) throw new AppError("appraisal_not_found", 404);
  return record;
};

const updateAppraisal = async ({
  actor,
  organizationId,
  appraisalId,
  kind,
  status,
  scheduledAt,
  periodLabel,
  completedAt,
  managerComments,
  goals,
  trainingNeeds,
  actionPoints,
  file,
}) => {
  const record = await loadAppraisal(appraisalId, organizationId);
  if (record.lockedAt) throw new AppError("appraisal_locked", 400);
  if (record.status !== ComplianceMeetingStatus.SCHEDULED) {
    throw new AppError("appraisal_not_editable", 400);
  }

  const staff = await loadStaff(record.staffId, organizationId);
  const standing = await assertCanAccessStaff({ actor, organizationId, staff });

  const hasUpdate =
    kind !== undefined ||
    status !== undefined ||
    scheduledAt !== undefined ||
    periodLabel !== undefined ||
    completedAt !== undefined ||
    managerComments !== undefined ||
    goals !== undefined ||
    trainingNeeds !== undefined ||
    actionPoints !== undefined ||
    file !== undefined;
  if (!hasUpdate) throw new AppError("nothing_to_update", 400);

  const meetingStatus = status ? parseAppraisalStatus(status) : record.status;
  if (meetingStatus === ComplianceMeetingStatus.COMPLETED) {
    await assertCanWriteAppraisal({ actor, organizationId, standing });
  }
  const [timezone, conductor] = await Promise.all([
    timezoneFor(staff.branchId),
    actorConductor({ actor, organizationId }),
  ]);

  if (kind !== undefined) record.kind = parseKind(kind);
  if (periodLabel !== undefined) record.periodLabel = periodLabel || "";
  if (scheduledAt !== undefined) {
    if (!scheduledAt && meetingStatus === ComplianceMeetingStatus.SCHEDULED) {
      throw new AppError("appraisal_schedule_required", 400);
    }
    record.scheduledAt = scheduledAt ? atZone(scheduledAt, timezone) : record.scheduledAt;
  }

  if (meetingStatus === ComplianceMeetingStatus.COMPLETED) {
    record.status = ComplianceMeetingStatus.COMPLETED;
    record.completedAt = completedAt
      ? atZone(completedAt, timezone)
      : moment.tz(timezone).toDate();
    record.conductedByStaffId = conductor.conductedByStaffId;
    record.conductedByUserId = conductor.conductedByUserId;
    if (managerComments !== undefined) record.managerComments = textFrom(managerComments);
    if (goals !== undefined) record.goals = textFrom(goals);
    if (trainingNeeds !== undefined) record.trainingNeeds = textFrom(trainingNeeds);
    if (actionPoints !== undefined) record.actionPoints = actionPointsFrom(actionPoints);
    if (file !== undefined) record.file = fileFrom(file);
  }

  await record.save();
  return record.toObject();
};

const maybeLock = (record) => {
  if (
    record.kind === AppraisalKind.ANNUAL &&
    record.staffSignedAt &&
    record.siteManagerSignedAt &&
    !record.lockedAt
  ) {
    record.lockedAt = new Date();
  }
};

const signOffActionPoint = async ({
  actor,
  organizationId,
  appraisalId,
  actionPointId,
}) => {
  const record = await loadAppraisal(appraisalId, organizationId);
  if (record.lockedAt) throw new AppError("appraisal_locked", 400);

  const staff = await loadStaff(record.staffId, organizationId);
  await assertWriterForStaff({ actor, organizationId, staff });

  const point = record.actionPoints.id(actionPointId);
  if (!point) throw new AppError("action_point_not_found", 404);

  const conductor = await actorConductor({ actor, organizationId });
  point.signedOffAt = moment.tz(await timezoneFor(staff.branchId)).toDate();
  point.signedOffByStaffId = conductor.conductedByStaffId;
  await record.save();
  return record.toObject();
};

const managerSignAppraisal = async ({ actor, organizationId, appraisalId }) => {
  const record = await loadAppraisal(appraisalId, organizationId);
  if (record.lockedAt) throw new AppError("appraisal_locked", 400);
  if (record.status !== ComplianceMeetingStatus.COMPLETED) {
    throw new AppError("appraisal_not_editable", 400);
  }

  const staff = await loadStaff(record.staffId, organizationId);
  await assertWriterForStaff({ actor, organizationId, staff });

  record.siteManagerSignedAt = moment.tz(await timezoneFor(staff.branchId)).toDate();
  record.siteManagerSignedByUserId = actor._id;
  maybeLock(record);
  await record.save();
  return record.toObject();
};

const myAppraisal = async ({ actor, organizationId }) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);

  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const [settings, meetings, timezone] = await Promise.all([
    loadOrgCycleSettings(organizationId),
    AppraisalRecord.aggregate([
      {
        $match: {
          organizationId: orgOid,
          staffId: staff._id,
          status: { $ne: ComplianceMeetingStatus.CANCELLED },
        },
      },
      { $sort: { completedAt: -1, scheduledAt: -1 } },
      ...conductedByStages,
    ]),
    timezoneFor(staff.branchId),
  ]);

  const intervalMonths = effectiveIntervals(staff, settings).appraisalMonths;
  const standing = supervisionStanding({
    startDate: staff.startDate,
    intervalMonths,
    meetings: standingMeetings(meetings),
    timezone,
  });

  return {
    compliance: {
      intervalMonths,
      completedThisCycle: standing.completedThisCycle,
      expectedThisCycle: standing.expectedThisCycle,
      score: standing.score,
      badge: standing.badge,
      nextDueAt: standing.nextDueAt,
      lastCompletedAt: standing.lastCompletedAt,
    },
    upcoming: standing.upcoming,
    past: meetings.filter((meeting) => meeting.status === ComplianceMeetingStatus.COMPLETED),
  };
};

const acknowledgeAppraisal = async ({ actor, organizationId, appraisalId }) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);

  const record = await loadAppraisal(appraisalId, organizationId);
  if (String(record.staffId) !== String(staff._id)) {
    throw new AppError("insufficient_role", 403);
  }
  if (record.lockedAt) throw new AppError("appraisal_locked", 400);
  if (record.status !== ComplianceMeetingStatus.COMPLETED) {
    throw new AppError("appraisal_not_editable", 400);
  }

  record.staffSignedAt = moment.tz(await timezoneFor(staff.branchId)).toDate();
  record.staffSignedByUserId = actor._id;
  maybeLock(record);
  await record.save();
  return record.toObject();
};

module.exports = {
  updateAppraisalSettings,
  updateStaffComplianceSettings,
  listTeamAppraisals,
  getAppraisal,
  createAppraisal,
  updateAppraisal,
  signOffActionPoint,
  managerSignAppraisal,
  myAppraisal,
  acknowledgeAppraisal,
};
