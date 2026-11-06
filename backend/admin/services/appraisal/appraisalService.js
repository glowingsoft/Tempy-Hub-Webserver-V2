const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { notifyStaff, whenOf } = require("../staff/staffNotify");
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
  scopeStaffIdForActor,
  MANAGER_ROLES,
} = require("../staff/staffAccess");
const { DEFAULT_TZ, inZone, supervisionStanding } = require("../supervision/supervisionSchedule");
const {
  loadOrgCycleSettings,
  effectiveIntervals,
} = require("./cycle");
const { updateStaffComplianceSettings } = require("../staff/complianceSettings");
const { actorConductor } = require("../staff/meetingConductor");
const { paginateWithFacet } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { toPublicImageUrl } = require("@utils/imageHelper");
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
  const scopedStaffId = await scopeStaffIdForActor({
    standing,
    actor,
    organizationId,
    staffId,
  });
  if (scopedStaffId === false) return [];

  const [reports, supervisees] = await Promise.all([
    resolveScopedStaffIds({
      standing,
      actor,
      organizationId,
      staffId: scopedStaffId,
      branchId,
    }),
    resolveScopedSuperviseeIds({
      standing,
      actor,
      organizationId,
      staffId: scopedStaffId,
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

const CSV_EXPORT_LIMIT = 10000;
const APPRAISAL_CSV_HEADERS = [
  "Name",
  "Email",
  "Site",
  "Review period",
  "Last review",
  "Next due",
  "Status",
];

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const csvDate = (value, timezone) => {
  if (!value) return "";
  const day = moment.tz(value, timezone || DEFAULT_TZ);
  return day.isValid() ? day.format("YYYY-MM-DD") : "";
};

const appraisalStatusLabel = (status) => {
  if (status === ComplianceMeetingStatus.SCHEDULED) return "Scheduled";
  if (status === ComplianceMeetingStatus.COMPLETED) return "Completed";
  if (status === ComplianceMeetingStatus.CANCELLED) return "Cancelled";
  return status || "";
};

const appraisalsToCsv = (rows) => {
  const lines = [APPRAISAL_CSV_HEADERS.join(",")];
  for (const row of rows) {
    const tz = row.branch?.timezone || DEFAULT_TZ;
    const period =
      String(row.periodLabel || "").trim() ||
      (row.kind === AppraisalKind.ANNUAL ? "Annual Review" : "");
    lines.push(
      [
        csvCell(row.staff?.name),
        csvCell(row.staff?.email),
        csvCell(row.branch?.name),
        csvCell(period),
        csvCell(csvDate(row.completedAt, tz)),
        csvCell(csvDate(row.scheduledAt, tz)),
        csvCell(appraisalStatusLabel(row.status)),
      ].join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
};

const csvExport = (rows) => ({
  csv: appraisalsToCsv(rows),
  fileName: "appraisals.csv",
});

const parseExportFormat = (format) => {
  const exportFormat = format ? String(format).trim().toLowerCase() : "";
  if (exportFormat && exportFormat !== "csv") {
    throw new AppError("invalid_export_format", 400);
  }
  return exportFormat === "csv";
};

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
  format,
}) => {
  const isCsv = parseExportFormat(format);
  const standing = await actorStanding(actor, organizationId);
  const ids = await scopedAppraisalStaffIds({
    standing,
    actor,
    organizationId,
    staffId: staffId ? toObjectId(staffId, "invalid_staff_profile_id") : null,
    branchId,
  });
  if (!ids.length) {
    return isCsv ? csvExport([]) : emptyPage(page, limit);
  }

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

  if (isCsv) {
    const rows = await AppraisalRecord.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $limit: CSV_EXPORT_LIMIT },
      ...appraisalRecordStages,
    ]);
    return csvExport(rows);
  }

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

  return {
    data: data.map(withSignatureUrls),
    meta: { ...meta, counts },
  };
};

const assertMayViewAppraisal = async ({ actor, organizationId, row }) => {
  const standing = await actorStanding(actor, organizationId);
  if (standing.role === MembershipRole.STAFF) {
    const mine = await StaffProfile.findOne({
      userId: actor._id,
      organizationId,
      status: StaffProfileStatus.ACTIVE,
    })
      .select("_id")
      .lean();
    if (!mine || String(row.staffId) !== String(mine._id)) {
      throw new AppError("insufficient_role", 403);
    }
    return standing;
  }
  await assertCanAccessStaff({
    actor,
    organizationId,
    staff: { _id: row.staffId, branchId: row.branchId },
  });
  return standing;
};

const getAppraisal = async ({ actor, organizationId, appraisalId }) => {
  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const recordId = toObjectId(appraisalId, "invalid_appraisal_id");
  const [row] = await AppraisalRecord.aggregate([
    { $match: { _id: recordId, organizationId: orgOid } },
    ...appraisalRecordStages,
  ]);
  if (!row) throw new AppError("appraisal_not_found", 404);

  await assertMayViewAppraisal({ actor, organizationId, row });
  return withSignatureUrls(row);
};

const optionalSignatureUrl = (value) =>
  value == null ? "" : String(value).trim();

const withSignatureUrls = (row) => {
  if (!row) return row;
  return {
    ...row,
    staffSignatureUrl: toPublicImageUrl(row.staffSignatureUrl),
    siteManagerSignatureUrl: toPublicImageUrl(row.siteManagerSignatureUrl),
  };
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

  if (record.scheduledAt && meetingStatus === ComplianceMeetingStatus.SCHEDULED) {
    await notifyStaff({
      staffId: staff._id,
      subjectId: actor._id,
      type: "meetingBooked",
      objectId: record._id,
      objectType: "appraisalRecord",
      title: "Appraisal booked",
      body: `Your appraisal is booked for ${whenOf(record.scheduledAt, timezone)}.`,
    });
  }

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

const shapeAppraisal = async (appraisalId, organizationId) => {
  const [row] = await AppraisalRecord.aggregate([
    {
      $match: {
        _id: toObjectId(appraisalId, "invalid_appraisal_id"),
        organizationId: toObjectId(organizationId, "invalid_organization_id"),
      },
    },
    ...appraisalRecordStages,
  ]);
  return withSignatureUrls(row);
};

const uniquePointIds = (value) => {
  if (!Array.isArray(value)) throw new AppError("invalid_action_points", 400);
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const id = String(item || "").trim();
    if (!id) continue;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError("action_point_not_found", 404);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

const applyAppraisalActionPointSignOffs = async ({
  record,
  staff,
  actor,
  signedOffIds,
  replaceSet,
}) => {
  const wanted = new Set(signedOffIds.map(String));
  for (const id of wanted) {
    if (!record.actionPoints.id(id)) throw new AppError("action_point_not_found", 404);
  }

  const now = moment.tz(await timezoneFor(staff.branchId)).toDate();
  const signerId = actor._id;

  for (const point of record.actionPoints) {
    const selected = wanted.has(String(point._id));
    if (selected) {
      if (!point.signedOffAt) {
        point.signedOffAt = now;
        point.signedOffByUserId = signerId;
      }
      continue;
    }
    const ownSign =
      replaceSet &&
      point.signedOffByUserId &&
      String(point.signedOffByUserId) === String(signerId);
    if (ownSign) {
      point.signedOffAt = null;
      point.signedOffByUserId = null;
    }
  }

  await record.save();
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

  await applyAppraisalActionPointSignOffs({
    record,
    staff,
    actor,
    signedOffIds: uniquePointIds([actionPointId]),
    replaceSet: false,
  });
  return shapeAppraisal(appraisalId, organizationId);
};

const signOffActionPoints = async ({
  actor,
  organizationId,
  appraisalId,
  actionPointIds,
}) => {
  const record = await loadAppraisal(appraisalId, organizationId);
  if (record.lockedAt) throw new AppError("appraisal_locked", 400);

  const staff = await loadStaff(record.staffId, organizationId);
  await assertWriterForStaff({ actor, organizationId, staff });

  await applyAppraisalActionPointSignOffs({
    record,
    staff,
    actor,
    signedOffIds: uniquePointIds(actionPointIds),
    replaceSet: true,
  });
  return shapeAppraisal(appraisalId, organizationId);
};

const managerSignAppraisal = async ({
  actor,
  organizationId,
  appraisalId,
  signatureUrl,
}) => {
  const record = await loadAppraisal(appraisalId, organizationId);
  if (record.lockedAt) throw new AppError("appraisal_locked", 400);
  if (record.status !== ComplianceMeetingStatus.COMPLETED) {
    throw new AppError("appraisal_not_editable", 400);
  }

  const staff = await loadStaff(record.staffId, organizationId);
  await assertWriterForStaff({ actor, organizationId, staff });

  record.siteManagerSignedAt = moment.tz(await timezoneFor(staff.branchId)).toDate();
  record.siteManagerSignedByUserId = actor._id;
  record.siteManagerSignatureUrl = optionalSignatureUrl(signatureUrl);
  maybeLock(record);
  await record.save();
  return shapeAppraisal(appraisalId, organizationId);
};

const supervisorNameOf = async (supervisorStaffId) => {
  if (!supervisorStaffId) return "";
  const [row] = await StaffProfile.aggregate([
    { $match: { _id: supervisorStaffId } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
        as: "user",
      },
    },
    {
      $project: {
        name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
      },
    },
  ]);
  return row?.name || "";
};

const myAppraisal = async ({
  actor,
  organizationId,
  status,
  page,
  limit,
  skip,
  format,
}) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);

  const listed = await listTeamAppraisals({
    actor,
    organizationId,
    staffId: staff._id,
    status,
    page,
    limit,
    skip,
    format,
  });
  if (listed.csv != null) return listed;

  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const [settings, meetings, timezone, supervisor] = await Promise.all([
    loadOrgCycleSettings(organizationId),
    AppraisalRecord.find({
      organizationId: orgOid,
      staffId: staff._id,
      status: { $ne: ComplianceMeetingStatus.CANCELLED },
    })
      .select("status completedAt scheduledAt kind")
      .lean(),
    timezoneFor(staff.branchId),
    supervisorNameOf(staff.supervisorStaffId),
  ]);

  const intervalMonths = effectiveIntervals(staff, settings).appraisalMonths;
  const standing = supervisionStanding({
    startDate: staff.startDate,
    intervalMonths,
    meetings: standingMeetings(meetings),
    timezone,
  });
  const behind = Math.max(0, standing.required - standing.completed);

  return {
    data: listed.data,
    meta: {
      ...listed.meta,
      compliance: {
        score: standing.score,
        badge: standing.badge,
        completed: standing.completed,
        expected: standing.required,
        completedThisCycle: standing.completedThisCycle,
        expectedThisCycle: standing.expectedThisCycle,
        intervalMonths,
        behind,
        nextDueAt: standing.nextDueAt,
        lastCompletedAt: standing.lastCompletedAt,
        supervisor,
      },
    },
  };
};

const acknowledgeAppraisal = async ({
  actor,
  organizationId,
  appraisalId,
  signatureUrl,
}) => {
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
  record.staffSignatureUrl = optionalSignatureUrl(signatureUrl);
  maybeLock(record);
  await record.save();
  return shapeAppraisal(appraisalId, organizationId);
};

module.exports = {
  updateAppraisalSettings,
  updateStaffComplianceSettings,
  listTeamAppraisals,
  getAppraisal,
  createAppraisal,
  updateAppraisal,
  signOffActionPoint,
  signOffActionPoints,
  managerSignAppraisal,
  myAppraisal,
  acknowledgeAppraisal,
};
