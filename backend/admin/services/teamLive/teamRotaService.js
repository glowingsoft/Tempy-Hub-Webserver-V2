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
} = require("@models/domainEnums");
const {
  actorStanding,
  resolveSubordinateStaffIds,
} = require("@adminServices/staff/staffAccess");

const DEFAULT_TZ = "Europe/London";
const VIEWS = ["day", "week"];
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

  if (key === "week") {
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

const getTeamRota = async ({
  actor,
  organizationId,
  date,
  view,
  departmentId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const tz = await loadTimezone(standing);
  const range = resolveRange({ date, view, tz });
  const orgOid = toOid(organizationId);
  const branchOid = toOid(standing.branchId);
  const departmentOid = toOid(departmentId);

  const match = {
    organizationId: orgOid,
    status: { $in: ROTA_SHIFT_STATUSES },
    startsAt: { $lt: range.to.toDate() },
    endsAt: { $gt: range.from.toDate() },
  };
  if (branchOid) match.branchId = branchOid;

  if (standing.role === MembershipRole.LINE_MANAGER) {
    const teamIds = await resolveSubordinateStaffIds({
      userId: actor._id,
      organizationId,
    });
    const teamOids = teamIds.map((id) => toOid(id));
    match.$or = [
      ...(teamOids.length ? [assignedMatch(teamOids)] : []),
      { staffId: null, status: ShiftStatus.OPEN },
    ];
    if (!match.$or.length) {
      return {
        view: range.view,
        from: range.from.format("YYYY-MM-DD"),
        to: range.to.format("YYYY-MM-DD"),
        items: [],
      };
    }
    delete match.status;
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
        pipeline: [{ $project: { name: 1, profileIcon: 1 } }, { $limit: 1 }],
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
    view: range.view,
    from: range.from.format("YYYY-MM-DD"),
    to: range.to.format("YYYY-MM-DD"),
    items,
  };
};

module.exports = { getTeamRota };
