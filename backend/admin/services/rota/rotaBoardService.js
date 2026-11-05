const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { Shift } = require("@models/Shift");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { Department } = require("@models/Department");
const { User } = require("@models/UserModel");
const { AppError } = require("@services/_errors/AppError");
const {
  ShiftStatus,
  StaffProfileStatus,
  MembershipRole,
} = require("@models/domainEnums");
const {
  MANAGER_ROLES,
  TEAM_APPROVER_ROLES,
  actorStanding,
  assertBranchInOrganization,
  scopeBranchFilter,
  resolveSubordinateStaffIds,
} = require("./shiftAccess");

const DEFAULT_TZ = "Europe/London";
const MAX_BOARD_DAYS = 56;
const BOARD_PERIODS = ["week", "fortnight", "month"];
const BOARD_SCOPES = ["personal", "managed", "all"];
const BOARD_SHIFT_STATUSES = [
  ShiftStatus.OPEN,
  ShiftStatus.SCHEDULED,
  ShiftStatus.COMPLETED,
];

const toOid = (value, key) => {
  if (value == null || String(value).trim() === "") return null;
  if (!mongoose.isValidObjectId(value)) throw new AppError(key, 400);
  return new mongoose.Types.ObjectId(String(value));
};

const defaultScopeForRole = (role) => {
  if (role === MembershipRole.STAFF) return "personal";
  if (role === MembershipRole.LINE_MANAGER) return "managed";
  return "all";
};

const parseScope = (value, role) => {
  const fallback = defaultScopeForRole(role);
  if (value == null || String(value).trim() === "") return fallback;
  const scope = String(value).trim();
  if (!BOARD_SCOPES.includes(scope)) throw new AppError("invalid_rota_scope", 400);
  if (role === MembershipRole.STAFF && scope !== "personal") {
    throw new AppError("insufficient_role", 403);
  }
  if (role === MembershipRole.LINE_MANAGER && scope === "all") {
    throw new AppError("insufficient_role", 403);
  }
  return scope;
};

const parsePeriod = (value) => {
  if (value == null || String(value).trim() === "") return "week";
  const period = String(value).trim();
  if (!BOARD_PERIODS.includes(period)) throw new AppError("invalid_rota_period", 400);
  return period;
};

const resolveBoardRange = ({ date, period, from, to, tz }) => {
  if (from || to) {
    const fromDay = from
      ? moment.tz(String(from).slice(0, 10), "YYYY-MM-DD", tz).startOf("day")
      : moment.tz(tz).startOf("isoWeek");
    const toDay = to
      ? moment.tz(String(to).slice(0, 10), "YYYY-MM-DD", tz).startOf("day")
      : fromDay.clone();
    if (!fromDay.isValid() || !toDay.isValid() || toDay.isBefore(fromDay)) {
      throw new AppError("invalid_date_range", 400);
    }
    if (toDay.diff(fromDay, "days") > MAX_BOARD_DAYS) {
      throw new AppError("rota_board_range_too_large", 400);
    }
    return { fromDay, toDay, period: "custom" };
  }

  const anchor = date
    ? moment.tz(String(date).slice(0, 10), "YYYY-MM-DD", tz)
    : moment.tz(tz);
  if (!anchor.isValid()) throw new AppError("invalid_date_format", 400);

  if (period === "month") {
    return {
      fromDay: anchor.clone().startOf("month"),
      toDay: anchor.clone().endOf("month").startOf("day"),
      period,
    };
  }

  const fromDay = anchor.clone().startOf("isoWeek");
  const toDay =
    period === "fortnight"
      ? fromDay.clone().add(13, "days")
      : fromDay.clone().endOf("isoWeek").startOf("day");
  return { fromDay, toDay, period };
};

const buildDays = (fromDay, toDay, tz) => {
  const today = moment.tz(tz).format("YYYY-MM-DD");
  const days = [];
  const cursor = fromDay.clone();
  while (!cursor.isAfter(toDay, "day")) {
    const date = cursor.format("YYYY-MM-DD");
    days.push({
      date,
      weekday: cursor.format("ddd"),
      isToday: date === today,
      isPast: date < today,
    });
    cursor.add(1, "days");
  }
  return days;
};

const emptyCell = (date) => ({ date, kind: "empty", shifts: [] });

const alignedCells = (days) => days.map((day) => emptyCell(day.date));

const shiftChip = (shift) => ({
  shiftId: shift._id,
  startsAt: shift.startsAt,
  endsAt: shift.endsAt,
  status: shift.status,
  urgentCover: Boolean(shift.urgentCover),
});

const cellKind = (shifts) => {
  if (!shifts.length) return "empty";
  if (shifts.every((item) => item.status === ShiftStatus.OPEN)) return "open";
  return "shift";
};

const putShiftOnCells = (cells, dateKey, chip) => {
  const cell = cells.find((item) => item.date === dateKey);
  if (!cell) return false;
  cell.shifts.push(chip);
  cell.kind = cellKind(cell.shifts);
  return true;
};

const minutesBetween = (startsAt, endsAt) => {
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 60000);
};

const getRotaBoard = async ({
  actor,
  organizationId,
  branchId: requestedBranchId,
  departmentId: requestedDepartmentId,
  date,
  period: requestedPeriod,
  scope: requestedScope,
  from,
  to,
}) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  const scope = parseScope(requestedScope, standing.role);
  const period = parsePeriod(requestedPeriod);
  const departmentOid = toOid(requestedDepartmentId, "invalid_department_id");

  let branchOid = toOid(
    scopeBranchFilter(standing, requestedBranchId),
    "invalid_branch_id"
  );

  let ownProfile = null;
  if (
    standing.role === MembershipRole.STAFF ||
    standing.role === MembershipRole.LINE_MANAGER ||
    scope === "personal"
  ) {
    ownProfile = await StaffProfile.findOne({
      userId: actor._id,
      organizationId: orgOid,
    })
      .select("_id branchId")
      .lean();
  }

  if (standing.role === MembershipRole.STAFF) {
    if (!ownProfile) throw new AppError("staff_profile_not_found", 403);
    branchOid = ownProfile.branchId;
  } else if (!branchOid) {
    throw new AppError("missing_branch_id", 400);
  }

  await assertBranchInOrganization(branchOid, organizationId);

  const branch = await Branch.findOne({
    _id: branchOid,
    organizationId: orgOid,
  })
    .select("timezone")
    .lean();
  if (!branch) throw new AppError("branch_not_found", 404);

  const tz = branch.timezone || DEFAULT_TZ;
  const { fromDay, toDay, period: resolvedPeriod } = resolveBoardRange({
    date,
    period,
    from,
    to,
    tz,
  });
  const days = buildDays(fromDay, toDay, tz);
  const fromUtc = fromDay.clone().startOf("day").toDate();
  const toExclusiveUtc = toDay.clone().add(1, "day").startOf("day").toDate();

  const staffMatch = {
    organizationId: orgOid,
    branchId: branchOid,
    status: StaffProfileStatus.ACTIVE,
  };
  if (departmentOid) staffMatch.departmentIds = departmentOid;

  if (scope === "personal") {
    if (!ownProfile) {
      return emptyBoard({
        branchId: branchOid,
        scope,
        period: resolvedPeriod,
        date,
        tz,
        fromDay,
        toDay,
        days,
        standing,
      });
    }
    staffMatch._id = ownProfile._id;
  } else if (scope === "managed") {
    const teamIds = await resolveSubordinateStaffIds({
      userId: actor._id,
      organizationId,
    });
    if (!teamIds.length) {
      return emptyBoard({
        branchId: branchOid,
        scope,
        period: resolvedPeriod,
        date,
        tz,
        fromDay,
        toDay,
        days,
        standing,
      });
    }
    staffMatch._id = { $in: teamIds };
  }

  const [staffRows, shifts] = await Promise.all([
    StaffProfile.aggregate([
      { $match: staffMatch },
      {
        $lookup: {
          from: User.collection.name,
          localField: "userId",
          foreignField: "_id",
          pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
          as: "_user",
        },
      },
      {
        $lookup: {
          from: Department.collection.name,
          localField: "departmentIds",
          foreignField: "_id",
          pipeline: [{ $project: { name: 1, sortOrder: 1 } }],
          as: "_departments",
        },
      },
      {
        $project: {
          employeeCode: 1,
          photoUrl: 1,
          name: { $ifNull: [{ $arrayElemAt: ["$_user.name", 0] }, ""] },
          departments: "$_departments",
        },
      },
      { $sort: { name: 1 } },
    ]),
    Shift.find({
      organizationId: orgOid,
      branchId: branchOid,
      status: { $in: BOARD_SHIFT_STATUSES },
      startsAt: { $gte: fromUtc, $lt: toExclusiveUtc },
    })
      .select("staffId startsAt endsAt status urgentCover")
      .lean(),
  ]);

  const staffById = new Map(
    staffRows.map((row) => [
      String(row._id),
      {
        staffId: row._id,
        name: row.name,
        employeeCode: row.employeeCode,
        photoUrl: row.photoUrl || "",
        totalMinutes: 0,
        cells: alignedCells(days),
        department: row.departments?.[0] || null,
      },
    ])
  );

  const unassignedCells = alignedCells(days);
  let unassignedCount = 0;
  let shiftCount = 0;
  let totalMinutes = 0;

  for (const shift of shifts) {
    const dateKey = moment.tz(shift.startsAt, tz).format("YYYY-MM-DD");
    const chip = shiftChip(shift);
    const minutes = minutesBetween(shift.startsAt, shift.endsAt);

    if (!shift.staffId) {
      if (putShiftOnCells(unassignedCells, dateKey, chip)) {
        unassignedCount += 1;
        shiftCount += 1;
        totalMinutes += minutes;
      }
      continue;
    }

    const row = staffById.get(String(shift.staffId));
    if (!row) continue;
    if (putShiftOnCells(row.cells, dateKey, chip)) {
      row.totalMinutes += minutes;
      shiftCount += 1;
      totalMinutes += minutes;
    }
  }

  const teamsMap = new Map();
  for (const row of staffById.values()) {
    const dept = row.department;
    const key = dept ? String(dept._id) : "none";
    if (!teamsMap.has(key)) {
      teamsMap.set(key, {
        departmentId: dept?._id || null,
        name: dept?.name || "No department",
        sortOrder: dept?.sortOrder ?? 9999,
        staff: [],
      });
    }
    teamsMap.get(key).staff.push({
      staffId: row.staffId,
      name: row.name,
      employeeCode: row.employeeCode,
      photoUrl: row.photoUrl,
      totalMinutes: row.totalMinutes,
      cells: row.cells,
    });
  }

  const teams = [...teamsMap.values()].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });

  const hasOpen = unassignedCells.some((cell) => cell.shifts.length);
  const fromDate = fromDay.format("YYYY-MM-DD");
  const toDate = toDay.format("YYYY-MM-DD");

  return {
    query: {
      branchId: branchOid,
      departmentId: departmentOid,
      scope,
      period: resolvedPeriod,
      date: date ? String(date).slice(0, 10) : fromDate,
      timezone: tz,
    },
    range: {
      from: fromDate,
      to: toDate,
      today: moment.tz(tz).format("YYYY-MM-DD"),
    },
    days,
    summary: {
      staffCount: staffById.size,
      shiftCount,
      totalMinutes,
      unassignedCount,
    },
    permissions: {
      canBookShift: MANAGER_ROLES.includes(standing.role),
      canRecordLeave: TEAM_APPROVER_ROLES.includes(standing.role),
    },
    teams,
    unassigned: hasOpen ? { cells: unassignedCells } : null,
  };
};

const emptyBoard = ({
  branchId,
  scope,
  period,
  date,
  tz,
  fromDay,
  toDay,
  days,
  standing,
}) => {
  const fromDate = fromDay.format("YYYY-MM-DD");
  return {
    query: {
      branchId,
      departmentId: null,
      scope,
      period,
      date: date ? String(date).slice(0, 10) : fromDate,
      timezone: tz,
    },
    range: {
      from: fromDate,
      to: toDay.format("YYYY-MM-DD"),
      today: moment.tz(tz).format("YYYY-MM-DD"),
    },
    days,
    summary: {
      staffCount: 0,
      shiftCount: 0,
      totalMinutes: 0,
      unassignedCount: 0,
    },
    permissions: {
      canBookShift: MANAGER_ROLES.includes(standing.role),
      canRecordLeave: TEAM_APPROVER_ROLES.includes(standing.role),
    },
    teams: [],
    unassigned: null,
  };
};

module.exports = { getRotaBoard };
