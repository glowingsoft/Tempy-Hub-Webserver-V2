const { LeaveRequest } = require("@models/LeaveRequest");
const { generateMeta } = require("@utils/responseUtil");
const { LeaveRequestStatus } = require("@models/domainEnums");
const {
  ACTIVITY_WINDOW_DAYS,
  staffNamesById,
  listAttendanceEvents,
  pageEvents,
} = require("@adminServices/siteLive/siteActivityQuery");

const windowStart = () => {
  const from = new Date();
  from.setDate(from.getDate() - ACTIVITY_WINDOW_DAYS);
  return from;
};

const leaveEvent = (request, type, occurredAt, title) => ({
  _id: request._id,
  type,
  occurredAt,
  title,
  subtitle: request.leaveType || "leave",
  ref: { kind: "leaveRequest", id: request._id },
});

const listLeaveEvents = async ({ staffIds, since }) => {
  const requests = await LeaveRequest.find({
    staffId: { $in: staffIds },
    $or: [{ createdAt: { $gte: since } }, { decidedAt: { $gte: since } }],
  })
    .select("staffId leaveType status createdAt decidedAt")
    .lean();

  const names = await staffNamesById(requests.map((row) => row.staffId));
  const events = [];

  for (const request of requests) {
    const name = names.get(String(request.staffId)) || "Staff";
    if (request.createdAt && request.createdAt >= since) {
      events.push(
        leaveEvent(request, "leave_requested", request.createdAt, `${name} requested leave`)
      );
    }
    if (request.decidedAt && request.decidedAt >= since) {
      if (request.status === LeaveRequestStatus.APPROVED) {
        events.push(
          leaveEvent(request, "leave_approved", request.decidedAt, `${name} leave approved`)
        );
      }
      if (request.status === LeaveRequestStatus.REJECTED) {
        events.push(
          leaveEvent(request, "leave_rejected", request.decidedAt, `${name} leave rejected`)
        );
      }
    }
  }

  return events;
};

const listTeamActivity = async ({ staffIds, page = 1, limit = 20, skip = 0 }) => {
  if (!staffIds?.length) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }

  const since = windowStart();
  const [attendance, leave] = await Promise.all([
    listAttendanceEvents({ staffIds, since, includeLate: true }),
    listLeaveEvents({ staffIds, since }),
  ]);

  return pageEvents([...attendance, ...leave], page, limit, skip);
};

module.exports = { listTeamActivity };
