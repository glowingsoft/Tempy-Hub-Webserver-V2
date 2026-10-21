const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Organization } = require("@models/Organization");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { SupervisionRecord } = require("@models/SupervisionRecord");
const { AppError } = require("@services/_errors/AppError");
const {
  ComplianceMeetingStatus,
  StaffProfileStatus,
  MembershipRole,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertMayApproveForStaff,
  resolveScopedStaffIds,
} = require("../staff/staffAccess");
const { DEFAULT_TZ, inZone, supervisionStanding } = require("./supervisionSchedule");
const { updateStaffComplianceSettings } = require("../staff/complianceSettings");
const { actorConductor, conductedByStages } = require("../staff/meetingConductor");

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
  if (!parsed.isValid()) throw new AppError("invalid_supervision_date", 400);
  return parsed.toDate();
};

const orgInterval = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("settings.defaultSupervisionIntervalMonths")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  return organization.settings?.defaultSupervisionIntervalMonths || 3;
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

const assertCanAccessStaff = async ({ actor, organizationId, staff }) => {
  const standing = await actorStanding(actor, organizationId);
  if (standing.role === MembershipRole.STAFF) {
    throw new AppError("insufficient_role", 403);
  }
  await assertMayApproveForStaff({
    standing,
    actor,
    organizationId,
    branchId: staff.branchId,
    targetStaffId: staff._id,
  });
  return standing;
};

const updateSupervisionSettings = (payload) => updateStaffComplianceSettings(payload);

const listTeamSupervision = async ({
  actor,
  organizationId,
  branchId,
  staffId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const ids = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId,
    branchId,
  });
  if (!ids.length) return [];

  const defaultInterval = await orgInterval(organizationId);
  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const rows = await StaffProfile.aggregate([
    { $match: { _id: { $in: ids }, organizationId: orgOid } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              name: 1,
              email: 1,
              image: { $ifNull: ["$profileIcon", ""] },
            },
          },
        ],
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        pipeline: [{ $project: { timezone: 1 } }],
        as: "branch",
      },
    },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: SupervisionRecord.collection.name,
        localField: "_id",
        foreignField: "staffId",
        pipeline: [
          {
            $match: {
              organizationId: orgOid,
              status: { $ne: ComplianceMeetingStatus.CANCELLED },
            },
          },
          {
            $project: {
              status: 1,
              completedAt: 1,
              scheduledAt: 1,
              locationLabel: 1,
            },
          },
        ],
        as: "meetings",
      },
    },
    {
      $project: {
        employeeCode: 1,
        startDate: 1,
        supervisionIntervalMonths: 1,
        timezone: "$branch.timezone",
        user: 1,
        meetings: 1,
      },
    },
  ]);

  return rows.map((row) => {
    const standingRow = supervisionStanding({
      startDate: row.startDate,
      intervalMonths: row.supervisionIntervalMonths || defaultInterval,
      meetings: row.meetings,
      timezone: row.timezone || DEFAULT_TZ,
    });
    return {
      staffId: row._id,
      employeeCode: row.employeeCode,
      name: row.user?.name || "",
      email: row.user?.email || "",
      image: row.user?.image || "",
      lastCompletedAt: standingRow.lastCompletedAt,
      nextDueAt: standingRow.nextDueAt,
      score: standingRow.score,
      badge: standingRow.badge,
      upcoming: standingRow.upcoming,
    };
  });
};

const textList = (value) => {
  if (!Array.isArray(value)) return [];
  const items = [];
  for (const item of value) {
    const text = String(item || "").trim();
    if (text) items.push(text);
  }
  return items;
};

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

const createSupervision = async ({
  actor,
  organizationId,
  staffId,
  status,
  scheduledAt,
  locationLabel,
  completedAt,
  topics,
  notes,
  actionPoints,
  file,
}) => {
  const staff = await loadStaff(
    toObjectId(staffId, "invalid_staff_profile_id"),
    organizationId
  );
  await assertCanAccessStaff({ actor, organizationId, staff });

  const meetingStatus = status || (
    completedAt ? ComplianceMeetingStatus.COMPLETED : ComplianceMeetingStatus.SCHEDULED
  );
  if (!Object.values(ComplianceMeetingStatus).includes(meetingStatus)) {
    throw new AppError("invalid_supervision_status", 400);
  }
  if (meetingStatus === ComplianceMeetingStatus.CANCELLED) {
    throw new AppError("invalid_supervision_status", 400);
  }
  if (meetingStatus === ComplianceMeetingStatus.SCHEDULED && !scheduledAt) {
    throw new AppError("supervision_schedule_required", 400);
  }

  const [timezone, conductor] = await Promise.all([
    timezoneFor(staff.branchId),
    actorConductor({ actor, organizationId }),
  ]);

  const record = await SupervisionRecord.create({
    organizationId,
    staffId: staff._id,
    branchId: staff.branchId,
    scheduledAt: scheduledAt ? atZone(scheduledAt, timezone) : null,
    locationLabel: locationLabel || "",
    completedAt:
      meetingStatus === ComplianceMeetingStatus.COMPLETED
        ? completedAt
          ? atZone(completedAt, timezone)
          : moment.tz(timezone).toDate()
        : null,
    conductedByStaffId: conductor.conductedByStaffId,
    conductedByUserId: conductor.conductedByUserId,
    topics: textList(topics),
    notes: notes || "",
    actionPoints: actionPointsFrom(actionPoints),
    file: fileFrom(file),
    status: meetingStatus,
  });

  return record.toObject();
};

const updateSupervision = async ({
  actor,
  organizationId,
  supervisionId,
  status,
  scheduledAt,
  locationLabel,
  completedAt,
  topics,
  notes,
  actionPoints,
  file,
}) => {
  const record = await SupervisionRecord.findOne({
    _id: toObjectId(supervisionId, "invalid_supervision_id"),
    organizationId: toObjectId(organizationId, "invalid_organization_id"),
  });
  if (!record) throw new AppError("supervision_not_found", 404);
  if (record.status !== ComplianceMeetingStatus.SCHEDULED) {
    throw new AppError("supervision_not_editable", 400);
  }

  const staff = await loadStaff(record.staffId, organizationId);
  await assertCanAccessStaff({ actor, organizationId, staff });

  const hasUpdate =
    status !== undefined ||
    scheduledAt !== undefined ||
    locationLabel !== undefined ||
    completedAt !== undefined ||
    topics !== undefined ||
    notes !== undefined ||
    actionPoints !== undefined ||
    file !== undefined;
  if (!hasUpdate) throw new AppError("nothing_to_update", 400);

  const meetingStatus = status || record.status;
  if (!Object.values(ComplianceMeetingStatus).includes(meetingStatus)) {
    throw new AppError("invalid_supervision_status", 400);
  }
  if (meetingStatus === ComplianceMeetingStatus.CANCELLED) {
    throw new AppError("invalid_supervision_status", 400);
  }

  const [timezone, conductor] = await Promise.all([
    timezoneFor(staff.branchId),
    actorConductor({ actor, organizationId }),
  ]);

  if (scheduledAt !== undefined) {
    if (!scheduledAt && meetingStatus === ComplianceMeetingStatus.SCHEDULED) {
      throw new AppError("supervision_schedule_required", 400);
    }
    record.scheduledAt = scheduledAt ? atZone(scheduledAt, timezone) : record.scheduledAt;
  }
  if (locationLabel !== undefined) record.locationLabel = locationLabel || "";

  if (meetingStatus === ComplianceMeetingStatus.COMPLETED) {
    record.status = ComplianceMeetingStatus.COMPLETED;
    record.completedAt = completedAt
      ? atZone(completedAt, timezone)
      : moment.tz(timezone).toDate();
    record.conductedByStaffId = conductor.conductedByStaffId;
    record.conductedByUserId = conductor.conductedByUserId;
    if (topics !== undefined) record.topics = textList(topics);
    if (notes !== undefined) record.notes = notes || "";
    if (actionPoints !== undefined) record.actionPoints = actionPointsFrom(actionPoints);
    if (file !== undefined) record.file = fileFrom(file);
  }

  await record.save();
  return record.toObject();
};

const signOffActionPoint = async ({
  actor,
  organizationId,
  supervisionId,
  actionPointId,
}) => {
  const record = await SupervisionRecord.findOne({
    _id: supervisionId,
    organizationId,
  });
  if (!record) throw new AppError("supervision_not_found", 404);

  const staff = await loadStaff(record.staffId, organizationId);
  await assertCanAccessStaff({ actor, organizationId, staff });

  const point = record.actionPoints.id(actionPointId);
  if (!point) throw new AppError("action_point_not_found", 404);

  const actorProfile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
  })
    .select("_id")
    .lean();

  point.signedOffAt = moment.tz(await timezoneFor(staff.branchId)).toDate();
  point.signedOffByStaffId = actorProfile?._id || null;
  await record.save();
  return record.toObject();
};

const mySupervision = async ({ actor, organizationId }) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);

  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const [defaultInterval, meetings, timezone] = await Promise.all([
    orgInterval(organizationId),
    SupervisionRecord.aggregate([
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

  const standing = supervisionStanding({
    startDate: staff.startDate,
    intervalMonths: staff.supervisionIntervalMonths || defaultInterval,
    meetings,
    timezone,
  });

  return {
    compliance: {
      completedThisCycle: standing.completedThisCycle,
      expectedThisCycle: standing.expectedThisCycle,
      score: standing.score,
      badge: standing.badge,
      nextDueAt: standing.nextDueAt,
    },
    upcoming: standing.upcoming,
    past: meetings.filter((meeting) => meeting.status === ComplianceMeetingStatus.COMPLETED),
  };
};

module.exports = {
  updateSupervisionSettings,
  listTeamSupervision,
  createSupervision,
  updateSupervision,
  signOffActionPoint,
  mySupervision,
};
