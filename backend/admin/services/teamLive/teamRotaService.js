const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { AppError } = require("@services/_errors/AppError");
const { Shift } = require("@models/Shift");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { Department } = require("@models/Department");
const { JobTitle } = require("@models/JobTitle");
const { AttendanceDay } = require("@models/AttendanceDay");
const { LeaveRequest } = require("@models/LeaveRequest");
const { Branch } = require("@models/Branch");
const {
  ShiftStatus,
  LeaveType,
  LeaveRequestStatus,
  PunctualityStatus,
  MembershipRole,
  StaffProfileStatus,
} = require("@models/domainEnums");
const {
  actorStanding,
  resolveSubordinateStaffIds,
} = require("@adminServices/staff/staffAccess");

const DEFAULT_TZ = "Europe/London";
const VIEWS = ["day", "week", "person"];
const ROTA_SCOPES = ["personal", "managed", "all"];
const DEFAULT_CONTRACTED_HOURS = 37.5;
const SICK_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.CLOSED,
];
const ROTA_SHIFT_STATUSES = [
  ShiftStatus.OPEN,
  ShiftStatus.SCHEDULED,
  ShiftStatus.COMPLETED,
];

const toOid = (value) =>
  value ? new mongoose.Types.ObjectId(String(value)) : null;

const loadTimezone = async (standing) => {
  if (!standing.branchId) return DEFAULT_TZ;
  const branch = await Branch.findById(standing.branchId)
    .select("timezone")
    .lean();
  return branch?.timezone || DEFAULT_TZ;
};

const resolveRange = ({ date, view, tz }) => {
  const key = String(view || "day").toLowerCase();
  if (!VIEWS.includes(key)) throw new AppError("invalid_view", 400);

  const day = date
    ? moment.tz(date, "YYYY-MM-DD", tz)
    : moment.tz(tz);
  if (!day.isValid()) throw new AppError("invalid_date_format", 400);

  if (key === "week" || key === "person") {
    return {
      view: key,
      from: day.clone().startOf("isoWeek"),
      to: day.clone().endOf("isoWeek"),
    };
  }
  return {
    view: key,
    from: day.clone().startOf("day"),
    to: day.clone().endOf("day"),
  };
};

const assignedMatch = (teamIds) => ({
  staffId: { $in: teamIds },
  status: { $in: [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED] },
});

const defaultScopeForRole = (role) => {
  if (role === MembershipRole.STAFF) return "personal";
  if (role === MembershipRole.LINE_MANAGER) return "managed";
  return "all";
};

const parseScope = (value, role) => {
  const fallback = defaultScopeForRole(role);
  if (value == null || String(value).trim() === "") return fallback;
  const scope = String(value).trim();
  if (!ROTA_SCOPES.includes(scope)) throw new AppError("invalid_rota_scope", 400);
  if (role === MembershipRole.STAFF && scope !== "personal") {
    throw new AppError("insufficient_role", 403);
  }
  if (role === MembershipRole.LINE_MANAGER && scope === "all") {
    throw new AppError("insufficient_role", 403);
  }
  return scope;
};

const rangeMeta = (range, scope) => ({
  view: range.view,
  scope,
  from: range.from.format("YYYY-MM-DD"),
  to: range.to.format("YYYY-MM-DD"),
});

const emptyDayWeekRota = (range, scope) => ({
  ...rangeMeta(range, scope),
  items: [],
});

const emptyPersonRota = (range, scope) => ({
  ...rangeMeta(range, scope),
  people: [],
  overContracted: [],
});

const loadOwnProfileId = async ({ actor, organizationId }) => {
  const profile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id")
    .lean();
  return profile?._id || null;
};

const resolveScopedStaffIds = async ({
  scope,
  actor,
  organizationId,
}) => {
  if (scope === "all") return { staffIds: null, includeOpen: true };

  if (scope === "personal") {
    const ownId = await loadOwnProfileId({ actor, organizationId });
    return {
      staffIds: ownId ? [ownId] : [],
      includeOpen: false,
    };
  }

  const teamIds = await resolveSubordinateStaffIds({
    userId: actor._id,
    organizationId,
  });
  return { staffIds: teamIds, includeOpen: true };
};

const roundHours = (value) => Math.round(Number(value || 0) * 10) / 10;

const getTeamRotaByPerson = async ({
  orgOid,
  branchOid,
  departmentOid,
  staffIds,
  range,
  scope,
}) => {
  if (staffIds && !staffIds.length) return emptyPersonRota(range, scope);

  const staffMatch = {
    organizationId: orgOid,
    status: StaffProfileStatus.ACTIVE,
  };
  if (branchOid) staffMatch.branchId = branchOid;
  if (departmentOid) staffMatch.departmentIds = departmentOid;
  if (staffIds) staffMatch._id = { $in: staffIds.map((id) => toOid(id)) };

  const from = range.from.toDate();
  const to = range.to.toDate();
  const hoursMatch = {
    organizationId: orgOid,
    status: { $in: [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED] },
    startsAt: { $lt: to },
    endsAt: { $gt: from },
  };
  if (branchOid) hoursMatch.branchId = branchOid;
  if (staffIds) hoursMatch.staffId = { $in: staffIds.map((id) => toOid(id)) };

  const [rows, hourRows] = await Promise.all([
    StaffProfile.aggregate([
      { $match: staffMatch },
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
        $project: {
          _id: 1,
          photoUrl: 1,
          contractedWeeklyHours: 1,
          name: { $ifNull: [{ $arrayElemAt: ["$_user.name", 0] }, ""] },
          email: { $ifNull: [{ $arrayElemAt: ["$_user.email", 0] }, ""] },
          icon: { $ifNull: [{ $arrayElemAt: ["$_user.profileIcon", 0] }, ""] },
        },
      },
      { $sort: { name: 1 } },
    ]),
    Shift.aggregate([
      { $match: hoursMatch },
      {
        $group: {
          _id: "$staffId",
          ms: { $sum: { $subtract: ["$endsAt", "$startsAt"] } },
        },
      },
    ]),
  ]);

  const hoursByStaff = new Map(
    hourRows.map((row) => [String(row._id), row.ms])
  );

  const people = rows.map((row) => {
    const contractedHours =
      Number(row.contractedWeeklyHours) || DEFAULT_CONTRACTED_HOURS;
    const scheduledHours = roundHours(
      (hoursByStaff.get(String(row._id)) || 0) / 3600000
    );
    return {
      staffId: row._id,
      name: row.name,
      email: row.email || "",
      photoUrl: row.photoUrl || row.icon || "",
      contractedHours,
      scheduledHours,
      overContracted: contractedHours > 0 && scheduledHours > contractedHours,
    };
  });

  return {
    ...rangeMeta(range, scope),
    people,
    overContracted: people
      .filter((row) => row.overContracted)
      .map((row) => ({ staffId: row.staffId, name: row.name })),
  };
};

const getTeamRota = async ({
  actor,
  organizationId,
  date,
  view,
  departmentId,
  scope: requestedScope,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const tz = await loadTimezone(standing);
  const range = resolveRange({ date, view, tz });
  const scope = parseScope(requestedScope, standing.role);
  const orgOid = toOid(organizationId);
  const branchOid = toOid(standing.branchId);
  const departmentOid =
    scope === "personal" ? null : toOid(departmentId);

  const { staffIds, includeOpen } = await resolveScopedStaffIds({
    scope,
    actor,
    organizationId,
  });

  if (range.view === "person") {
    return getTeamRotaByPerson({
      orgOid,
      branchOid,
      departmentOid,
      staffIds,
      range,
      scope,
    });
  }

  if (staffIds && !staffIds.length && !includeOpen) {
    return emptyDayWeekRota(range, scope);
  }

  const match = {
    organizationId: orgOid,
    startsAt: { $lt: range.to.toDate() },
    endsAt: { $gt: range.from.toDate() },
  };
  if (branchOid) match.branchId = branchOid;

  const staffOids = staffIds ? staffIds.map((id) => toOid(id)) : null;

  if (staffOids) {
    match.$or = [
      ...(staffOids.length ? [assignedMatch(staffOids)] : []),
      ...(includeOpen ? [{ staffId: null, status: ShiftStatus.OPEN }] : []),
    ];
    if (!match.$or.length) return emptyDayWeekRota(range, scope);
  } else {
    match.status = { $in: ROTA_SHIFT_STATUSES };
  }

  const items = await Shift.aggregate([
    { $match: match },
    {
      $addFields: {
        workDate: {
          $dateFromString: {
            dateString: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$startsAt",
                timezone: tz,
              },
            },
            timezone: "UTC",
          },
        },
      },
    },
    {
      $lookup: {
        from: StaffProfile.collection.name,
        localField: "staffId",
        foreignField: "_id",
        pipeline: [
          { $project: { userId: 1, departmentIds: 1, jobTitleId: 1, photoUrl: 1 } },
          { $limit: 1 },
        ],
        as: "staffDoc",
      },
    },
    { $unwind: { path: "$staffDoc", preserveNullAndEmptyArrays: true } },
    ...(departmentOid
      ? [
          {
            $match: {
              $or: [
                { staffId: null },
                { "staffDoc.departmentIds": departmentOid },
              ],
            },
          },
        ]
      : []),
    {
      $lookup: {
        from: User.collection.name,
        localField: "staffDoc.userId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1, email: 1, profileIcon: 1 } }, { $limit: 1 }],
        as: "userDoc",
      },
    },
    {
      $lookup: {
        from: Department.collection.name,
        localField: "staffDoc.departmentIds",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
        as: "departmentDoc",
      },
    },
    {
      $lookup: {
        from: JobTitle.collection.name,
        localField: "staffDoc.jobTitleId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
        as: "jobTitleDoc",
      },
    },
    {
      $lookup: {
        from: AttendanceDay.collection.name,
        let: { shiftId: "$_id", staffId: "$staffId", workDate: "$workDate" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$shiftId", "$$shiftId"] },
                  {
                    $and: [
                      { $eq: ["$staffId", "$$staffId"] },
                      { $eq: ["$workDate", "$$workDate"] },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { clockInAt: -1 } },
          { $limit: 1 },
        ],
        as: "attendance",
      },
    },
    {
      $lookup: {
        from: LeaveRequest.collection.name,
        let: {
          shiftId: "$_id",
          staffId: "$staffId",
          workDate: "$workDate",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$staffId", "$$staffId"] },
                  { $eq: ["$leaveType", LeaveType.SICK] },
                  { $in: ["$status", SICK_STATUSES] },
                  { $lte: ["$startDate", "$$workDate"] },
                  {
                    $gte: [
                      "$endDate",
                      "$$workDate",
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { createdAt: 1 } },
          { $limit: 1 },
        ],
        as: "sick",
      },
    },
    {
      $addFields: {
        attendance: { $arrayElemAt: ["$attendance", 0] },
        sick: { $arrayElemAt: ["$sick", 0] },
      },
    },
    {
      $project: {
        _id: 0,
        shiftId: "$_id",
        staffId: { $ifNull: ["$staffId", null] },
        staffName: { $ifNull: [{ $arrayElemAt: ["$userDoc.name", 0] }, ""] },
        email: { $ifNull: [{ $arrayElemAt: ["$userDoc.email", 0] }, ""] },
        photoUrl: {
          $ifNull: [
            "$staffDoc.photoUrl",
            { $ifNull: [{ $arrayElemAt: ["$userDoc.profileIcon", 0] }, ""] },
          ],
        },
        jobTitle: {
          $ifNull: [{ $arrayElemAt: ["$jobTitleDoc.name", 0] }, ""],
        },
        department: {
          $ifNull: [{ $arrayElemAt: ["$departmentDoc.name", 0] }, ""],
        },
        workDate: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$startsAt",
            timezone: tz,
          },
        },
        startsAt: 1,
        endsAt: 1,
        status: 1,
        visibility: 1,
        urgentCover: { $ifNull: ["$urgentCover", false] },
        clockInAt: { $ifNull: ["$attendance.clockInAt", null] },
        clockOutAt: { $ifNull: ["$attendance.clockOutAt", null] },
        punctualityStatus: {
          $ifNull: ["$attendance.punctualityStatus", null],
        },
        presenceStatus: { $ifNull: ["$attendance.presenceStatus", null] },
        chip: {
          $cond: [
            { $ifNull: ["$sick._id", false] },
            "sick",
            {
              $cond: [
                {
                  $eq: ["$attendance.punctualityStatus", PunctualityStatus.LATE],
                },
                "late",
                null,
              ],
            },
          ],
        },
      },
    },
    { $sort: { startsAt: 1 } },
  ]);

  return {
    ...rangeMeta(range, scope),
    items,
  };
};

module.exports = { getTeamRota };
