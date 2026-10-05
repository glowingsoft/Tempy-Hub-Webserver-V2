const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { VisitSession } = require("@models/VisitSession");
const { Branch } = require("@models/Branch");
const { AppError } = require("@services/_errors/AppError");
const {
  ExternalPersonType,
  VisitSessionStatus,
} = require("@models/domainEnums");

const GROUP_BY = {
  TYPE: "type",
  BRANCH: "branch",
  DAY: "day",
  STATUS: "status",
};

const DEFAULT_TIMEZONE = "Europe/London";
const DATE_ONLY = "YYYY-MM-DD";
const PERSON_TYPES = Object.values(ExternalPersonType);
const SESSION_STATUSES = Object.values(VisitSessionStatus);

const toObjectId = (value, key = "invalid_id") => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(value);
};

const parseBool = (value) =>
  value === true || value === "true" || value === "1";

const parseCsvEnum = (value, allowed, errorKey) => {
  if (value === undefined || value === null || value === "") return null;
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
  for (const item of list) {
    if (!allowed.includes(item)) throw new AppError(errorKey, 400);
  }
  return list;
};

const resolveTimezone = (timezone) => {
  if (!timezone) return DEFAULT_TIMEZONE;
  if (!moment.tz.zone(timezone)) {
    throw new AppError("invalid_timezone", 400);
  }
  return timezone;
};

/**
 * Parse from/to with moment-timezone.
 * - `YYYY-MM-DD` → start/end of that calendar day in the branch timezone
 * - ISO / other moment-parsable → interpreted in that timezone when possible
 */
const parseBound = (value, field, timezone, bound) => {
  if (value === undefined || value === null || value === "") return null;

  const raw = String(value).trim();
  let m;

  if (moment(raw, DATE_ONLY, true).isValid()) {
    m =
      bound === "start"
        ? moment.tz(raw, DATE_ONLY, timezone).startOf("day")
        : moment.tz(raw, DATE_ONLY, timezone).endOf("day");
  } else {
    m = moment.tz(raw, timezone);
    if (!m.isValid()) m = moment(raw);
  }

  if (!m.isValid()) {
    throw new AppError("invalid_date_format", 400, {
      field,
      format: `${DATE_ONLY} or ISO-8601`,
    });
  }

  return m.utc().toDate();
};

const parseDateRange = ({ from, to, timezone }) => {
  const tz = resolveTimezone(timezone);
  const fromDate = parseBound(from, "from", tz, "start");
  const toDate = parseBound(to, "to", tz, "end");
  if (fromDate && toDate && fromDate > toDate) {
    throw new AppError("invalid_date_range", 400);
  }
  return { fromDate, toDate, timezone: tz };
};

const parseGroupBy = (groupBy) => {
  const value = groupBy || GROUP_BY.TYPE;
  if (!Object.values(GROUP_BY).includes(value)) {
    throw new AppError("invalid_visit_group_by", 400);
  }
  return value;
};

const parsePersonTypes = (personType) =>
  parseCsvEnum(personType, PERSON_TYPES, "invalid_external_person_type");

const parseStatuses = (status) =>
  parseCsvEnum(status, SESSION_STATUSES, "invalid_visit_session_status");

const resolveBranches = async ({ organizationId, branchId }) => {
  const orgOid = toObjectId(organizationId, "invalid_organization_id");

  if (branchId) {
    const branchOid = toObjectId(branchId, "invalid_branch_id");
    const branch = await Branch.findOne({
      _id: branchOid,
      organizationId: orgOid,
    })
      .select("_id timezone")
      .lean();
    if (!branch) throw new AppError("branch_not_found", 404);
    return [branch];
  }

  return Branch.find({ organizationId: orgOid })
    .select("_id timezone")
    .lean();
};

const asInFilter = (list) =>
  !list?.length ? undefined : list.length === 1 ? list[0] : { $in: list };

const buildMatch = ({
  branchOids,
  personTypes,
  statuses,
  onSiteOnly,
  fromDate,
  toDate,
}) => {
  const match = { branchId: { $in: branchOids } };

  if (onSiteOnly) {
    match.status = VisitSessionStatus.ON_SITE;
    match.checkOutAt = null;
  } else {
    const statusFilter = asInFilter(statuses);
    if (statusFilter !== undefined) match.status = statusFilter;
  }

  const typeFilter = asInFilter(personTypes);
  if (typeFilter !== undefined) match.personType = typeFilter;

  if (fromDate || toDate) {
    match.checkInAt = {};
    if (fromDate) match.checkInAt.$gte = fromDate;
    if (toDate) match.checkInAt.$lte = toDate;
  }

  return match;
};

const groupIdExpression = (groupBy, timezone) => {
  if (groupBy === GROUP_BY.BRANCH) {
    return { branchId: "$branchId", personType: "$personType" };
  }
  if (groupBy === GROUP_BY.DAY) {
    return {
      day: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: "$checkInAt",
          timezone,
        },
      },
      personType: "$personType",
    };
  }
  if (groupBy === GROUP_BY.STATUS) {
    return { status: "$status", personType: "$personType" };
  }
  return "$personType";
};

const emptyCounts = () =>
  Object.fromEntries(PERSON_TYPES.map((type) => [type, 0]));

const mapBreakdownRow = (groupBy, row) => {
  const count = row.count || 0;
  if (groupBy === GROUP_BY.TYPE) {
    return { personType: row._id, count };
  }
  if (groupBy === GROUP_BY.BRANCH) {
    return {
      branchId: row._id?.branchId || null,
      personType: row._id?.personType || null,
      count,
    };
  }
  if (groupBy === GROUP_BY.DAY) {
    return {
      day: row._id?.day || null,
      personType: row._id?.personType || null,
      count,
    };
  }
  return {
    status: row._id?.status || null,
    personType: row._id?.personType || null,
    count,
  };
};

const formatBoundIso = (date, timezone) =>
  date ? moment(date).tz(timezone).format() : null;

/**
 * One DB aggregation for visit presence / analytics.
 * Dates use moment-timezone (branch timezone, or ?timezone=).
 */
const aggregateVisitPresence = async (opts = {}) => {
  const groupBy = parseGroupBy(opts.groupBy);
  const personTypes = parsePersonTypes(opts.personType ?? opts.type);
  const statuses = parseStatuses(opts.status);
  const onSiteOnly = parseBool(opts.onSiteOnly);

  const branches = await resolveBranches({
    organizationId: opts.organizationId,
    branchId: opts.branchId,
  });

  const timezone = resolveTimezone(
    opts.timezone || branches[0]?.timezone || DEFAULT_TIMEZONE
  );
  const { fromDate, toDate } = parseDateRange({
    from: opts.from,
    to: opts.to,
    timezone,
  });

  const branchOids = branches.map((b) => b._id);
  const counts = emptyCounts();

  if (!branchOids.length) {
    return {
      groupBy,
      branchId: opts.branchId || null,
      timezone,
      onSiteOnly,
      from: null,
      to: null,
      total: 0,
      counts,
      breakdown: [],
    };
  }

  const rows = await VisitSession.aggregate([
    {
      $match: buildMatch({
        branchOids,
        personTypes,
        statuses,
        onSiteOnly,
        fromDate,
        toDate,
      }),
    },
    {
      $group: {
        _id: groupIdExpression(groupBy, timezone),
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  let total = 0;
  const breakdown = rows.map((row) => {
    const item = mapBreakdownRow(groupBy, row);
    total += item.count;
    if (item.personType && counts[item.personType] !== undefined) {
      counts[item.personType] += item.count;
    }
    return item;
  });

  return {
    groupBy,
    branchId: opts.branchId || null,
    timezone,
    onSiteOnly,
    from: formatBoundIso(fromDate, timezone),
    to: formatBoundIso(toDate, timezone),
    total,
    counts,
    breakdown,
  };
};

const countVisitPresenceByType = (opts = {}) =>
  aggregateVisitPresence({ ...opts, groupBy: GROUP_BY.TYPE });

module.exports = {
  GROUP_BY,
  aggregateVisitPresence,
  countVisitPresenceByType,
  resolveBranches,
  parsePersonTypes,
  parseStatuses,
  parseGroupBy,
  parseDateRange,
  parseBool,
  toObjectId,
};
