const mongoose = require("mongoose");
const { AppError } = require("@services/_errors/AppError");
const { Branch } = require("@models/Branch");
const { ExternalPerson } = require("@models/ExternalPerson");
const { Resident } = require("@models/Resident");
const { StaffProfile } = require("@models/StaffProfile");
const { JobTitle } = require("@models/JobTitle");
const {
  AdmissionStatus,
  ExternalPersonType,
  MembershipRole,
  StaffProfileStatus,
} = require("@models/domainEnums");

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const resolvePeriod = (period, now) => {
  if (period === "thisMonth") {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    return {
      start,
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
  if (period === "thisQuarter") {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 1)),
    };
  }
  if (period === "thisYear") {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)),
    };
  }
  throw new AppError("invalid_statistics_period", 400);
};

const getPreviousPeriod = (period, currentRange) => {
  if (period === "thisMonth") {
    return {
      start: new Date(
        Date.UTC(
          currentRange.start.getUTCFullYear(),
          currentRange.start.getUTCMonth() - 1,
          1,
        ),
      ),
      end: currentRange.start,
    };
  }
  if (period === "thisQuarter") {
    return {
      start: new Date(
        Date.UTC(
          currentRange.start.getUTCFullYear(),
          currentRange.start.getUTCMonth() - 3,
          1,
        ),
      ),
      end: currentRange.start,
    };
  }
  return {
    start: new Date(Date.UTC(currentRange.start.getUTCFullYear() - 1, 0, 1)),
    end: currentRange.start,
  };
};

const leftAtStage = {
  $addFields: {
    leftAt: {
      $cond: [
        { $eq: ["$status", StaffProfileStatus.INACTIVE] },
        { $ifNull: ["$inactiveAt", "$updatedAt"] },
        null,
      ],
    },
  },
};

const getWorkforcePeriod = async (staffScope, range) => {
  const employedAt = (date) => ({
    $and: [
      { $lt: ["$startDate", date] },
      { $or: [{ $eq: ["$leftAt", null] }, { $gte: ["$leftAt", date] }] },
    ],
  });
  const inRange = (field) => ({
    $and: [{ $gte: [field, range.start] }, { $lt: [field, range.end] }],
  });
  const [row] = await StaffProfile.aggregate([
    { $match: staffScope },
    leftAtStage,
    {
      $group: {
        _id: null,
        startingHeadcount: { $sum: { $cond: [employedAt(range.start), 1, 0] } },
        retainedHeadcount: {
          $sum: {
            $cond: [
              { $and: [employedAt(range.start), employedAt(range.end)] },
              1,
              0,
            ],
          },
        },
        newStarters: { $sum: { $cond: [inRange("$startDate"), 1, 0] } },
        leavers: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ["$leftAt", null] }, inRange("$leftAt")] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const {
    startingHeadcount = 0,
    retainedHeadcount = 0,
    newStarters = 0,
    leavers = 0,
  } = row || {};

  return {
    retentionRate: startingHeadcount
      ? (retainedHeadcount / startingHeadcount) * 100
      : 0,
    newStarters,
    leavers,
  };
};

const getStatistics = async ({
  organizationId,
  requestedBranchId,
  role,
  membershipBranchId,
  year,
  period = "thisQuarter",
  now = new Date(),
}) => {
  const effectiveBranchId =
    role === MembershipRole.SITE_MANAGER
      ? membershipBranchId
      : requestedBranchId;
  const scope = { organizationId: new mongoose.Types.ObjectId(organizationId) };

  if (effectiveBranchId) {
    if (!mongoose.Types.ObjectId.isValid(String(effectiveBranchId))) {
      throw new AppError("invalid_branch_id", 400);
    }
    const branch = await Branch.findOne({
      _id: effectiveBranchId,
      organizationId: scope.organizationId,
    })
      .select("_id")
      .lean();
    if (!branch) throw new AppError("branch_not_found", 404);
    scope.branchId = branch._id;
  }

  const selectedYear = Number(year);
  if (
    !Number.isInteger(selectedYear) ||
    selectedYear < 2000 ||
    selectedYear > 2100
  ) {
    throw new AppError("invalid_statistics_year", 400);
  }

  const yearStart = new Date(Date.UTC(selectedYear, 0, 1));
  const yearEnd = new Date(Date.UTC(selectedYear + 1, 0, 1));
  const range = resolvePeriod(period, now);
  const previousRange = getPreviousPeriod(period, range);
  const staffScope = { ...scope };
  const peopleScope = effectiveBranchId
    ? { branchId: scope.branchId }
    : {
        branchId: {
          $in: await Branch.find({
            organizationId: scope.organizationId,
          }).distinct("_id"),
        },
      };

  const [
    residentCount,
    staffCounts,
    externalCounts,
    roleHires,
    monthlyHires,
    workforce,
    previousWorkforce,
  ] = await Promise.all([
    Resident.countDocuments({
      ...scope,
      admissionStatus: AdmissionStatus.ADMITTED,
    }),
    StaffProfile.aggregate([
      { $match: staffScope },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    ExternalPerson.aggregate([
      { $match: peopleScope },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]),
    StaffProfile.aggregate([
      { $match: { ...staffScope, status: StaffProfileStatus.ACTIVE } },
      { $group: { _id: "$jobTitleId", count: { $sum: 1 } } },
    ]),
    StaffProfile.aggregate([
      { $match: { ...staffScope, startDate: { $lt: yearEnd } } },
      leftAtStage,
      {
        $project: {
          jobTitleId: 1,
          startMonth: {
            $cond: [
              { $lt: ["$startDate", yearStart] },
              0,
              { $month: "$startDate" },
            ],
          },
          leaveMonth: {
            $cond: [
              {
                $or: [
                  { $eq: ["$leftAt", null] },
                  { $gte: ["$leftAt", yearEnd] },
                ],
              },
              null,
              {
                $cond: [
                  { $lt: ["$leftAt", yearStart] },
                  0,
                  { $month: "$leftAt" },
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            jobTitleId: "$jobTitleId",
            startMonth: "$startMonth",
            leaveMonth: "$leaveMonth",
          },
          count: { $sum: 1 },
        },
      },
    ]),
    getWorkforcePeriod(staffScope, range),
    getWorkforcePeriod(staffScope, previousRange),
  ]);

  const titleIds = [
    ...new Set(
      [...roleHires, ...monthlyHires]
        .map((row) => String(row._id?.jobTitleId || row._id || ""))
        .filter(Boolean),
    ),
  ];
  const titles = await JobTitle.find({
    _id: { $in: titleIds },
    organizationId: scope.organizationId,
  })
    .select("name")
    .lean();
  const titleNames = new Map(
    titles.map((title) => [String(title._id), title.name]),
  );
  const titleName = (id) => titleNames.get(String(id)) || "Unassigned";
  const countByType = new Map(
    externalCounts.map((row) => [row._id, row.count]),
  );
  const countByStatus = new Map(staffCounts.map((row) => [row._id, row.count]));
  const activeStaff = countByStatus.get(StaffProfileStatus.ACTIVE) || 0;

  const employeesByRole = roleHires.map((row) => ({
    role: titleName(row._id),
    count: row.count,
  }));
  const rowsByTitle = new Map();
  monthlyHires.forEach((row) => {
    const key = String(row._id.jobTitleId);
    rowsByTitle.set(key, [...(rowsByTitle.get(key) || []), row]);
  });
  const employeesOverTime = [...rowsByTitle]
    .map(([jobTitleId, rows]) => ({
      role: titleName(jobTitleId),
      data: MONTHS.map((_, index) => {
        const month = index + 1;
        return rows
          .filter(
            ({ _id }) =>
              _id.startMonth <= month &&
              (_id.leaveMonth === null || _id.leaveMonth > month),
          )
          .reduce((total, row) => total + row.count, 0);
      }),
    }))
    .filter((series) => series.data.some(Boolean));

  const retentionRate = Math.round(workforce.retentionRate);
  const previousRetentionRate = Math.round(previousWorkforce.retentionRate);

  return {
    scope: {
      organizationId: scope.organizationId,
      branchId: scope.branchId || null,
    },
    summary: {
      visitors: countByType.get(ExternalPersonType.VISITOR) || 0,
      residents: residentCount,
      contractors: countByType.get(ExternalPersonType.CONTRACTOR) || 0,
      staff: activeStaff,
      professionals: countByType.get(ExternalPersonType.PROFESSIONAL) || 0,
    },
    employeesByRole: {
      total: activeStaff,
      roles: employeesByRole,
    },
    employeesOverTime: {
      year: selectedYear,
      months: MONTHS,
      series: employeesOverTime,
    },
    workforceMovement: {
      period,
      retentionRate: {
        value: retentionRate,
        change: Number(
          (workforce.retentionRate - previousWorkforce.retentionRate).toFixed(
            1,
          ),
        ),
        previousValue: previousRetentionRate,
      },
      newStarters: {
        value: workforce.newStarters,
        change: workforce.newStarters - previousWorkforce.newStarters,
        previousValue: previousWorkforce.newStarters,
      },
      leavers: {
        value: workforce.leavers,
        change: workforce.leavers - previousWorkforce.leavers,
        previousValue: previousWorkforce.leavers,
      },
    },
  };
};

module.exports = { getStatistics, getWorkforcePeriod, resolvePeriod };
