const mongoose = require("mongoose");
const { VisitSession } = require("@models/VisitSession");
const { AttendanceDay } = require("@models/AttendanceDay");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { ResidentMedia } = require("@models/ResidentMedia");
const { ExternalPerson } = require("@models/ExternalPerson");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { generateMeta } = require("@utils/responseUtil");
const {
  VisitSessionStatus,
  VisitMethod,
  ResidentMediaReviewStatus,
  PunctualityStatus,
} = require("@models/domainEnums");

const ACTIVITY_WINDOW_DAYS = 30;
const ACTIVITY_PREVIEW_LIMIT = 5;

const toOid = (value) => new mongoose.Types.ObjectId(String(value));

const windowStart = () => {
  const from = new Date();
  from.setDate(from.getDate() - ACTIVITY_WINDOW_DAYS);
  return from;
};

const visitEventsPipeline = (branchId, since) => [
  {
    $match: {
      branchId,
      $or: [
        { checkInAt: { $gte: since } },
        { checkOutAt: { $gte: since } },
        { updatedAt: { $gte: since } },
      ],
    },
  },
  {
    $lookup: {
      from: ExternalPerson.collection.name,
      localField: "externalPersonId",
      foreignField: "_id",
      as: "_person",
      pipeline: [{ $project: { name: 1, type: 1 } }],
    },
  },
  {
    $addFields: {
      _name: {
        $ifNull: [{ $arrayElemAt: ["$_person.name", 0] }, "Visitor"],
      },
      _kindLabel: { $ifNull: ["$personType", "visitor"] },
    },
  },
  {
    $addFields: {
      _events: {
        $filter: {
          input: [
            {
              $cond: [
                { $eq: ["$status", VisitSessionStatus.DENIED] },
                {
                  type: "visit_denied",
                  occurredAt: { $ifNull: ["$updatedAt", "$arrivedAt"] },
                  title: { $concat: ["$_name", " denied entry"] },
                  subtitle: {
                    $concat: ["$_kindLabel", " · ", { $ifNull: ["$purposeOfVisit", "Walk-in"] }],
                  },
                  ref: { kind: "visitSession", id: "$_id" },
                },
                null,
              ],
            },
            {
              $cond: [
                {
                  $and: [
                    { $ne: ["$status", VisitSessionStatus.DENIED] },
                    { $ne: ["$status", VisitSessionStatus.AWAITING_APPROVAL] },
                    { $ne: ["$checkInAt", null] },
                  ],
                },
                {
                  type: {
                    $cond: [
                      { $eq: ["$method", VisitMethod.WALK_IN] },
                      "visit_approved",
                      "visit_check_in",
                    ],
                  },
                  occurredAt: "$checkInAt",
                  title: {
                    $concat: [
                      "$_name",
                      {
                        $cond: [
                          { $eq: ["$method", VisitMethod.WALK_IN] },
                          " approved",
                          " checked in",
                        ],
                      },
                    ],
                  },
                  subtitle: {
                    $concat: ["$_kindLabel", " · ", { $ifNull: ["$purposeOfVisit", "Visit"] }],
                  },
                  ref: { kind: "visitSession", id: "$_id" },
                },
                null,
              ],
            },
            {
              $cond: [
                { $ne: ["$checkOutAt", null] },
                {
                  type: "visit_check_out",
                  occurredAt: "$checkOutAt",
                  title: { $concat: ["$_name", " checked out"] },
                  subtitle: "$_kindLabel",
                  ref: { kind: "visitSession", id: "$_id" },
                },
                null,
              ],
            },
          ],
          as: "event",
          cond: { $ne: ["$$event", null] },
        },
      },
    },
  },
  { $unwind: "$_events" },
  {
    $replaceRoot: {
      newRoot: {
        _id: "$_id",
        type: "$_events.type",
        occurredAt: "$_events.occurredAt",
        title: "$_events.title",
        subtitle: "$_events.subtitle",
        ref: "$_events.ref",
      },
    },
  },
];

const staffNamesById = async (staffIds) => {
  const ids = [...new Set(staffIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();

  const profiles = await StaffProfile.find({ _id: { $in: ids } })
    .select("userId")
    .lean();
  const users = await User.find({
    _id: { $in: profiles.map((row) => row.userId) },
  })
    .select("name")
    .lean();
  const nameByUser = new Map(users.map((row) => [String(row._id), row.name]));
  const names = new Map();
  for (const profile of profiles) {
    names.set(String(profile._id), nameByUser.get(String(profile.userId)) || "Staff");
  }
  return names;
};

const attendanceEvent = (day, type, occurredAt, title, subtitle) => ({
  _id: day._id,
  type,
  occurredAt,
  title,
  subtitle,
  ref: { kind: "attendanceDay", id: day._id },
});

const listAttendanceEvents = async ({
  branchId,
  staffIds,
  since,
  includeLate = false,
}) => {
  const match = {
    $or: [{ clockInAt: { $gte: since } }, { clockOutAt: { $gte: since } }],
  };
  if (branchId) match.branchId = branchId;
  if (staffIds?.length) match.staffId = { $in: staffIds };

  const days = await AttendanceDay.find(match)
    .select("staffId clockInAt clockOutAt checkInMethod punctualityStatus")
    .lean();
  const names = await staffNamesById(days.map((day) => day.staffId));
  const events = [];

  for (const day of days) {
    const name = names.get(String(day.staffId)) || "Staff";
    const method = day.checkInMethod || "kiosk";

    if (day.clockInAt && day.clockInAt >= since) {
      events.push(
        attendanceEvent(day, "staff_clock_in", day.clockInAt, `${name} clocked in`, method)
      );
      if (includeLate && day.punctualityStatus === PunctualityStatus.LATE) {
        events.push(
          attendanceEvent(day, "staff_late", day.clockInAt, `${name} arrived late`, method)
        );
      }
    }
    if (day.clockOutAt && day.clockOutAt >= since) {
      events.push(
        attendanceEvent(day, "staff_clock_out", day.clockOutAt, `${name} clocked out`, "Staff")
      );
    }
  }

  return events;
};

const pageEvents = (events, page, limit, skip) => {
  const sorted = events
    .filter((row) => row.occurredAt)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  return {
    data: sorted.slice(skip, skip + limit),
    meta: generateMeta(page, limit, sorted.length),
  };
};

const evacEventsPipeline = (branchId, since) => [
  {
    $match: {
      branchId,
      $or: [{ startedAt: { $gte: since } }, { closedAt: { $gte: since } }],
    },
  },
  {
    $addFields: {
      _events: {
        $filter: {
          input: [
            {
              type: "evac_started",
              occurredAt: "$startedAt",
              title: {
                $cond: [
                  { $eq: ["$type", "real"] },
                  "Fire emergency started",
                  "Evacuation drill started",
                ],
              },
              subtitle: { $ifNull: ["$type", "drill"] },
              ref: { kind: "evacuationEvent", id: "$_id" },
            },
            {
              $cond: [
                { $ne: ["$closedAt", null] },
                {
                  type: "evac_closed",
                  occurredAt: "$closedAt",
                  title: "Evacuation closed",
                  subtitle: { $ifNull: ["$type", "drill"] },
                  ref: { kind: "evacuationEvent", id: "$_id" },
                },
                null,
              ],
            },
          ],
          as: "event",
          cond: { $ne: ["$$event", null] },
        },
      },
    },
  },
  { $unwind: "$_events" },
  {
    $replaceRoot: {
      newRoot: {
        _id: "$_id",
        type: "$_events.type",
        occurredAt: "$_events.occurredAt",
        title: "$_events.title",
        subtitle: "$_events.subtitle",
        ref: "$_events.ref",
      },
    },
  },
];

const photoEventsPipeline = (branchId, since) => [
  {
    $match: {
      branchId,
      reviewedAt: { $gte: since },
      reviewStatus: {
        $in: [
          ResidentMediaReviewStatus.APPROVED,
          ResidentMediaReviewStatus.REJECTED,
        ],
      },
    },
  },
  {
    $lookup: {
      from: Resident.collection.name,
      localField: "residentId",
      foreignField: "_id",
      as: "_resident",
      pipeline: [{ $project: { name: 1, roomNumber: 1 } }],
    },
  },
  {
    $addFields: {
      _name: {
        $ifNull: [{ $arrayElemAt: ["$_resident.name", 0] }, "Resident"],
      },
      _room: { $ifNull: [{ $arrayElemAt: ["$_resident.roomNumber", 0] }, ""] },
    },
  },
  {
    $project: {
      _id: 1,
      type: { $literal: "photo_reviewed" },
      occurredAt: "$reviewedAt",
      title: {
        $concat: ["Photo ", "$reviewStatus", " · ", "$_name"],
      },
      subtitle: "$_room",
      ref: { kind: { $literal: "residentMedia" }, id: "$_id" },
    },
  },
];

const listSiteActivity = async ({ branchId, page = 1, limit = 20, skip = 0 }) => {
  const bid = toOid(branchId);
  const since = windowStart();

  const [other, attendance] = await Promise.all([
    VisitSession.aggregate([
      ...visitEventsPipeline(bid, since),
      {
        $unionWith: {
          coll: EvacuationEvent.collection.name,
          pipeline: evacEventsPipeline(bid, since),
        },
      },
      {
        $unionWith: {
          coll: ResidentMedia.collection.name,
          pipeline: photoEventsPipeline(bid, since),
        },
      },
      { $match: { occurredAt: { $ne: null, $gte: since } } },
    ]),
    listAttendanceEvents({ branchId: bid, since }),
  ]);

  return pageEvents([...(other || []), ...attendance], page, limit, skip);
};

module.exports = {
  ACTIVITY_PREVIEW_LIMIT,
  ACTIVITY_WINDOW_DAYS,
  staffNamesById,
  listAttendanceEvents,
  pageEvents,
  listSiteActivity,
};
