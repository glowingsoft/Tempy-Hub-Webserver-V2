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
  assertMaySuperviseStaff,
  resolveScopedSuperviseeIds,
  scopeStaffIdForActor,
} = require("../staff/staffAccess");
const { DEFAULT_TZ, inZone, supervisionStanding } = require("./supervisionSchedule");
const { updateStaffComplianceSettings } = require("../staff/complianceSettings");
const { actorConductor, conductedByStages } = require("../staff/meetingConductor");
const { paginateWithFacet, facetCount } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");

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

const viewerTimezone = (timezone) => {
  const value = String(timezone || "").trim();
  if (value && moment.tz.zone(value)) return value;
  return DEFAULT_TZ;
};

const formatAt = (value, timezone) => {
  if (value == null || value === "") return null;
  const parsed = inZone(value, timezone);
  return parsed.isValid() ? parsed.format() : null;
};

const datesForViewer = (row, timezone) => ({
  ...row,
  scheduledAt: formatAt(row.scheduledAt, timezone),
  completedAt: formatAt(row.completedAt, timezone),
  createdAt: formatAt(row.createdAt, timezone),
  updatedAt: formatAt(row.updatedAt, timezone),
  actionPoints: (row.actionPoints || []).map((point) => ({
    ...point,
    signedOffAt: formatAt(point.signedOffAt, timezone),
  })),
});

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
  await assertMaySuperviseStaff({
    standing,
    actor,
    organizationId,
    branchId: staff.branchId,
    targetStaffId: staff._id,
  });
  return standing;
};

const updateSupervisionSettings = (payload) => updateStaffComplianceSettings(payload);

const MEETING_STATUSES = Object.values(ComplianceMeetingStatus);

const emptyStatusCounts = () =>
  Object.fromEntries(MEETING_STATUSES.map((status) => [status, 0]));

const statusCountFacets = (countMatch) =>
  Object.fromEntries(
    MEETING_STATUSES.map((status) => [
      `${status}Count`,
      [{ $match: { ...countMatch, status } }, { $count: "count" }],
    ])
  );

const statusCountsFromFacet = (result) =>
  Object.fromEntries(
    MEETING_STATUSES.map((status) => [status, facetCount(result[`${status}Count`])])
  );

const parseMeetingStatus = (status) => {
  if (status == null || String(status).trim() === "" || String(status).trim() === "all") {
    return undefined;
  }
  const value = String(status).trim();
  if (!MEETING_STATUSES.includes(value)) {
    throw new AppError("invalid_supervision_status", 400);
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

const staffLookup = {
  $lookup: {
    from: StaffProfile.collection.name,
    localField: "staffId",
    foreignField: "_id",
    pipeline: [
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
            { $limit: 1 },
          ],
          as: "user",
        },
      },
      {
        $project: {
          employeeCode: 1,
          branchId: 1,
          startDate: 1,
          name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
          email: { $ifNull: [{ $arrayElemAt: ["$user.email", 0] }, ""] },
          image: { $ifNull: [{ $arrayElemAt: ["$user.image", 0] }, ""] },
        },
      },
      { $limit: 1 },
    ],
    as: "staff",
  },
};

const branchLookup = {
  $lookup: {
    from: Branch.collection.name,
    localField: "branchId",
    foreignField: "_id",
    pipeline: [{ $project: { name: 1, code: 1, timezone: 1 } }, { $limit: 1 }],
    as: "branch",
  },
};

const signedOffLookup = {
  $lookup: {
    from: User.collection.name,
    localField: "actionPoints.signedOffByUserId",
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
    as: "signedOffUsers",
  },
};

const attachSignedOffNames = {
  $addFields: {
    staff: { $arrayElemAt: ["$staff", 0] },
    branch: { $arrayElemAt: ["$branch", 0] },
    actionPoints: {
      $map: {
        input: { $ifNull: ["$actionPoints", []] },
        as: "point",
        in: {
          $mergeObjects: [
            "$$point",
            {
              signedOffByUser: {
                $let: {
                  vars: {
                    signer: {
                      $first: {
                        $filter: {
                          input: "$signedOffUsers",
                          as: "row",
                          cond: { $eq: ["$$row._id", "$$point.signedOffByUserId"] },
                        },
                      },
                    },
                  },
                  in: { $ifNull: ["$$signer", null] },
                },
              },
            },
          ],
        },
      },
    },
  },
};

const recordShapeStages = [
  ...conductedByStages,
  staffLookup,
  branchLookup,
  signedOffLookup,
  attachSignedOffNames,
  {
    $addFields: {
      actionPoints: {
        $map: {
          input: "$actionPoints",
          as: "point",
          in: {
            $mergeObjects: [
              "$$point",
              {
                signedOffBy: { $ifNull: ["$$point.signedOffByUser.name", ""] },
              },
            ],
          },
        },
      },
    },
  },
  { $project: { signedOffUsers: 0 } },
];

const listTeamSupervision = async ({
  actor,
  organizationId,
  branchId,
  staffId,
  status,
  keyword,
  timezone,
  page,
  limit,
  skip,
}) => {
  const tz = viewerTimezone(timezone || actor?.timezone);
  const standing = await actorStanding(actor, organizationId);
  const requestedStaffId = staffId
    ? toObjectId(staffId, "invalid_staff_profile_id")
    : null;
  const scopedStaffId = await scopeStaffIdForActor({
    standing,
    actor,
    organizationId,
    staffId: requestedStaffId,
  });
  if (scopedStaffId === false) {
    const empty = emptyPage(page, limit);
    return { ...empty, meta: { ...empty.meta, timezone: tz } };
  }
  const ids = await resolveScopedSuperviseeIds({
    standing,
    actor,
    organizationId,
    staffId: scopedStaffId,
    branchId,
  });
  if (!ids.length) {
    const empty = emptyPage(page, limit);
    return { ...empty, meta: { ...empty.meta, timezone: tz } };
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
      { locationLabel: regex },
      { notes: regex },
      { topics: regex },
    ];
  }

  const meetingStatus = parseMeetingStatus(status);
  const countMatch = { ...match };
  if (meetingStatus) match.status = meetingStatus;

  const { data, meta, result } = await paginateWithFacet({
    model: SupervisionRecord,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: recordShapeStages,
    extraFacets: statusCountFacets(countMatch),
  });

  return {
    data: data.map((row) => datesForViewer(row, tz)),
    meta: { ...meta, counts: statusCountsFromFacet(result), timezone: tz },
  };
};

const assertMayViewSupervision = async ({ actor, organizationId, row }) => {
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
  await assertMaySuperviseStaff({
    standing,
    actor,
    organizationId,
    branchId: row.branchId,
    targetStaffId: row.staffId,
  });
  return standing;
};

const getSupervision = async ({ actor, organizationId, supervisionId, timezone }) => {
  const tz = viewerTimezone(timezone || actor?.timezone);
  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const recordId = toObjectId(supervisionId, "invalid_supervision_id");
  const [row] = await SupervisionRecord.aggregate([
    { $match: { _id: recordId, organizationId: orgOid } },
    ...recordShapeStages,
  ]);
  if (!row) throw new AppError("supervision_not_found", 404);

  await assertMayViewSupervision({ actor, organizationId, row });
  return datesForViewer(row, tz);
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

const loadSupervisionForAccess = async ({ actor, organizationId, supervisionId }) => {
  const record = await SupervisionRecord.findOne({
    _id: toObjectId(supervisionId, "invalid_supervision_id"),
    organizationId: toObjectId(organizationId, "invalid_organization_id"),
  });
  if (!record) throw new AppError("supervision_not_found", 404);

  const staff = await loadStaff(record.staffId, organizationId);
  await assertCanAccessStaff({ actor, organizationId, staff });
  return { record, staff };
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

const applyActionPointSignOffs = async ({
  record,
  staff,
  actor,
  organizationId,
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
  return record.toObject();
};

const signOffActionPoint = async ({
  actor,
  organizationId,
  supervisionId,
  actionPointId,
}) => {
  const { record, staff } = await loadSupervisionForAccess({
    actor,
    organizationId,
    supervisionId,
  });
  return applyActionPointSignOffs({
    record,
    staff,
    actor,
    organizationId,
    signedOffIds: uniquePointIds([actionPointId]),
    replaceSet: false,
  });
};

/** Body `actionPointIds` is the full checked set: sent = signed off, omitted = open. */
const signOffActionPoints = async ({
  actor,
  organizationId,
  supervisionId,
  actionPointIds,
}) => {
  const { record, staff } = await loadSupervisionForAccess({
    actor,
    organizationId,
    supervisionId,
  });
  return applyActionPointSignOffs({
    record,
    staff,
    actor,
    organizationId,
    signedOffIds: uniquePointIds(actionPointIds),
    replaceSet: true,
  });
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

const mySupervision = async ({
  actor,
  organizationId,
  timezone: viewerTz,
  status,
  page,
  limit,
  skip,
}) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);

  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const [listed, defaultInterval, meetings, timezone, supervisor] =
    await Promise.all([
      listTeamSupervision({
        actor,
        organizationId,
        staffId: staff._id,
        status,
        timezone: viewerTz,
        page,
        limit,
        skip,
      }),
      orgInterval(organizationId),
      SupervisionRecord.find({
        organizationId: orgOid,
        staffId: staff._id,
        status: { $ne: ComplianceMeetingStatus.CANCELLED },
      })
        .select("status completedAt scheduledAt")
        .lean(),
      timezoneFor(staff.branchId),
      supervisorNameOf(staff.supervisorStaffId),
    ]);

  const intervalMonths = staff.supervisionIntervalMonths || defaultInterval;
  const standing = supervisionStanding({
    startDate: staff.startDate,
    intervalMonths,
    meetings,
    timezone,
  });
  const behind = Math.max(0, standing.required - standing.completed);
  const monthsEmployed = staff.startDate
    ? Math.max(0, moment.tz(timezone).diff(moment.tz(staff.startDate, timezone), "months"))
    : 0;

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
        monthsEmployed,
        behind,
        nextDueAt: standing.nextDueAt,
        supervisor,
      },
    },
  };
};

module.exports = {
  updateSupervisionSettings,
  listTeamSupervision,
  getSupervision,
  createSupervision,
  updateSupervision,
  signOffActionPoint,
  signOffActionPoints,
  mySupervision,
};
