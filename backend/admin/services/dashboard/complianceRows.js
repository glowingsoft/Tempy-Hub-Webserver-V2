const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { RequirementCellStatus } = require("@models/domainEnums");

const MEETING_ORDER = ["overdue", "dueSoon", "booked", "onTrack", "notYetDue"];
const COUNT_FIELD = {
  [RequirementCellStatus.VALID]: "complete",
  [RequirementCellStatus.DUE_SOON]: "dueSoon",
  [RequirementCellStatus.EXPIRED]: "overdue",
  [RequirementCellStatus.IN_PROGRESS]: "pending",
};

const REQUIREMENT_STATUS = {
  [RequirementCellStatus.EXPIRED]: "overdue",
  [RequirementCellStatus.DUE_SOON]: "dueSoon",
  [RequirementCellStatus.IN_PROGRESS]: "pending",
  [RequirementCellStatus.VALID]: "valid",
};
const URGENCY = ["overdue", "dueSoon", "pending", "valid"];

const staffNames = async (staff) => {
  if (!staff.length) return new Map();
  const names = await StaffProfile.aggregate([
    { $match: { _id: { $in: staff.map((member) => member._id) } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    { $project: { name: { $ifNull: ["$user.name", ""] } } },
  ]);
  return new Map(names.map((row) => [String(row._id), row.name]));
};

const trainingRows = async ({ staff, cells }) => {
  const nameOf = await staffNames(staff);
  return cells
    .filter(
      (row) => row.type === "training" && REQUIREMENT_STATUS[row.cell.status],
    )
    .map(({ assignmentId, staffId, name, cell }) => ({
      assignmentId,
      staffName: nameOf.get(String(staffId)) || "",
      name,
      status: REQUIREMENT_STATUS[cell.status],
      dueAt: cell.dueDate || null,
      completedAt: cell.completedAt || null,
    }))
    .sort(
      (a, b) =>
        URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status) ||
        a.staffName.localeCompare(b.staffName) ||
        a.name.localeCompare(b.name),
    );
};

const requirementRows = (cells, type) => {
  const byName = new Map();
  cells
    .filter((row) => row.type === type && row.cell.expected)
    .forEach(({ name, cell }) => {
      const row = byName.get(name) || {
        name,
        total: 0,
        complete: 0,
        dueSoon: 0,
        pending: 0,
        overdue: 0,
        dueAt: null,
      };
      row.total += 1;
      row[COUNT_FIELD[cell.status] || "pending"] += 1;
      if (!cell.met && cell.dueDate && (!row.dueAt || cell.dueDate < row.dueAt))
        row.dueAt = cell.dueDate;
      byName.set(name, row);
    });
  const share = (count, total) => Math.round((count / total) * 100);
  return [...byName.values()]
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.pending - a.pending ||
        a.name.localeCompare(b.name),
    )
    .map((row) => ({
      ...row,
      complete: share(row.complete, row.total),
      dueSoon: share(row.dueSoon, row.total),
      pending: share(row.pending, row.total),
      overdue: share(row.overdue, row.total),
    }));
};

const meetingRows = async ({
  staff,
  supervisionStandings,
  appraisalStandings,
}) => {
  const nameOf = await staffNames(staff);
  const rows = [];
  const collect = (type, standings) =>
    standings.forEach((standing, index) =>
      rows.push({
        type,
        staffName: nameOf.get(String(staff[index]._id)) || "",
        status: standing.badge,
        completed: standing.completed,
        expected: standing.required,
        dueAt:
          standing.badge === "overdue"
            ? null
            : standing.upcoming?.scheduledAt || standing.nextDueAt,
      }),
    );
  collect("supervision", supervisionStandings);
  collect("appraisal", appraisalStandings);
  return rows.sort(
    (a, b) =>
      MEETING_ORDER.indexOf(a.status) - MEETING_ORDER.indexOf(b.status) ||
      a.staffName.localeCompare(b.staffName),
  );
};

module.exports = { requirementRows, trainingRows, meetingRows };
