const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { Shift } = require("@models/Shift");
const { AttendanceDay } = require("@models/AttendanceDay");
const { StaffProfile } = require("@models/StaffProfile");
const { Department } = require("@models/Department");
const { JobTitle } = require("@models/JobTitle");
const { User } = require("@models/UserModel");
const { NotificationExp } = require("@models/Notifications");
const {
  ModuleSlug,
  PresenceStatus,
  ShiftStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { generateMeta } = require("@utils/responseUtil");
const { resolveLiveBranchId } = require("@adminServices/siteLive/siteLiveService");

const DEFAULT_TZ = "Europe/London";
const DAY = "YYYY-MM-DD";
const TABS = ["full", "whosIn"];
const COUNTED = [ShiftStatus.OPEN, ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED];
const STILL_IN_HOURS = 24;

const MODULE_OF_TAB = {
  full: ModuleSlug.ROTA_SCHEDULING,
  whosIn: ModuleSlug.SIGN_IN_ATTENDANCE,
};

const parseTab = (value) => {
  const tab = String(value || "full").trim();
  if (!TABS.includes(tab)) throw new AppError("invalid_rota_tab", 400, { validTabs: TABS.join(", ") });
  return tab;
};

const assertModule = ({ organization, isPlatformAdmin, slug }) => {
  if (isPlatformAdmin) return;
  const active = (organization?.moduleAccess || []).some(
    (module) =>
      module.moduleSlug === slug &&
      module.enabled &&
      (!module.expiresAt || new Date(module.expiresAt) > new Date()),
  );
  if (!active) throw new AppError("module_not_enabled", 403, { module: slug });
};

const weekOf = (date, timezone, now) => {
  const day = date ? moment.tz(date, DAY, true, timezone) : moment(now).tz(timezone);
  if (!day.isValid()) throw new AppError("invalid_date_format", 400);
  const start = day.clone().startOf("isoWeek");
  return { start, end: start.clone().add(1, "week") };
};

const greetingOf = (timezone, now) => {
  const hour = moment(now).tz(timezone).hour();
  if (hour < 12) return "Good Morning";
  return hour < 18 ? "Good Afternoon" : "Good Evening";
};

const headerOf = async ({ actor, timezone, now }) => ({
  greeting: greetingOf(timezone, now),
  name: actor.name || "",
  photoUrl: actor.profileIcon || "",
  unreadNotifications: await NotificationExp.countDocuments({
    receiverId: actor._id,
    isRead: false,
    isDeleted: { $ne: true },
  }),
});

const hoursText = (hours) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(hours);

const dayStatus = ({ total, open }) => {
  if (!total) return { key: "none", label: "No Shifts" };
  return open
    ? { key: "open", label: `Fill ${open} Open` }
    : { key: "covered", label: "Covered" };
};

const fullRota = async ({ branchId, week, timezone }) => {
  const shifts = await Shift.find({
    branchId,
    status: { $in: COUNTED },
    startsAt: { $gte: week.start.toDate(), $lt: week.end.toDate() },
  })
    .select("staffId startsAt endsAt status")
    .lean();

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = week.start.clone().add(index, "days");
    return { date: day.format(DAY), label: day.format("ddd D"), filled: 0, total: 0, open: 0 };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  let minutes = 0;
  shifts.forEach((shift) => {
    const day = byDate.get(moment(shift.startsAt).tz(timezone).format(DAY));
    if (!day) return;
    day.total += 1;
    if (shift.status === ShiftStatus.OPEN || !shift.staffId) day.open += 1;
    else day.filled += 1;
    minutes += Math.max((new Date(shift.endsAt) - new Date(shift.startsAt)) / 60000, 0);
  });

  const total = days.reduce((sum, day) => sum + day.total, 0);
  const hours = Math.round((minutes / 60) * 10) / 10;

  return {
    summary: {
      title: "This Week",
      shifts: total,
      hours,
      open: days.reduce((sum, day) => sum + day.open, 0),
      label: `${total} ${total === 1 ? "Shift" : "Shifts"} - ${hoursText(hours)} h`,
      status: total
        ? { key: "published", label: "All Published" }
        : { key: "none", label: "No Shifts" },
    },
    days: days.map((day) => ({
      ...day,
      shiftsLabel: `${day.filled} / ${day.total} Shifts`,
      status: dayStatus(day),
    })),
  };
};

const sinceLabel = (clockInAt, timezone, now) => {
  const start = moment(clockInAt).tz(timezone);
  const today = moment(now).tz(timezone);
  const time = start.format("HH:mm");
  if (start.isSame(today, "day")) return `Since ${time}`;
  if (start.isSame(today.clone().subtract(1, "day"), "day")) return `Since ${time} Yesterday`;
  return `Since ${time} ${start.format("D MMM")}`;
};

const mapById = (rows) => new Map(rows.map((row) => [String(row._id), row]));

const whosIn = async ({ branchId, timezone, page, limit, skip, now }) => {
  const rows = await AttendanceDay.find({
    branchId,
    presenceStatus: { $in: [PresenceStatus.ON_SITE, PresenceStatus.ON_BREAK] },
    clockOutAt: null,
    clockInAt: { $gte: new Date(now.getTime() - STILL_IN_HOURS * 3600000) },
  })
    .sort({ clockInAt: -1 })
    .select("staffId clockInAt presenceStatus")
    .lean();

  const seen = new Set();
  const present = rows.filter((row) => {
    const key = String(row.staffId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const profiles = present.length
    ? await StaffProfile.find({ _id: { $in: present.map((row) => row.staffId) } })
        .select("userId photoUrl jobTitleId departmentIds")
        .lean()
    : [];
  const profileById = mapById(profiles);
  const [users, jobTitles, departments] = await Promise.all([
    User.find({ _id: { $in: profiles.map((profile) => profile.userId) } })
      .select("name profileIcon")
      .lean(),
    JobTitle.find({ _id: { $in: profiles.map((profile) => profile.jobTitleId).filter(Boolean) } })
      .select("name")
      .lean(),
    Department.find({ _id: { $in: profiles.flatMap((profile) => profile.departmentIds || []) } })
      .select("name sortOrder")
      .lean(),
  ]);
  const userById = mapById(users);
  const jobById = mapById(jobTitles);
  const departmentById = mapById(departments);

  const groups = new Map();
  const people = present.map((row) => {
    const profile = profileById.get(String(row.staffId));
    const user = userById.get(String(profile?.userId));
    const jobTitle = jobById.get(String(profile?.jobTitleId))?.name || "";
    const department = departmentById.get(String(profile?.departmentIds?.[0]));
    const key = department ? String(department._id) : "none";
    const group = groups.get(key) || {
      departmentId: department?._id || null,
      name: department?.name || "No Department",
      sortOrder: department?.sortOrder ?? 9999,
      count: 0,
    };
    group.count += 1;
    groups.set(key, group);
    const since = sinceLabel(row.clockInAt, timezone, now);
    return {
      staffId: row.staffId,
      name: user?.name || "",
      photoUrl: profile?.photoUrl || user?.profileIcon || "",
      jobTitle,
      department: department?.name || "",
      clockInAt: row.clockInAt,
      onBreak: row.presenceStatus === PresenceStatus.ON_BREAK,
      since,
      subtitle: [jobTitle, since].filter(Boolean).join(" - "),
    };
  });

  const largest = Math.max(...[...groups.values()].map((group) => group.count), 0);

  return {
    inNow: {
      title: "In Now",
      total: people.length,
      departments: [...groups.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map(({ sortOrder, ...group }) => ({
          ...group,
          percent: Math.round((group.count / largest) * 100),
        })),
    },
    people: people.slice(skip, skip + limit),
    meta: generateMeta(page, limit, people.length),
  };
};

const getRotaScreen = async ({
  actor,
  organizationId,
  organization,
  isPlatformAdmin,
  branchId,
  tab,
  date,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const selected = parseTab(tab);
  assertModule({ organization, isPlatformAdmin, slug: MODULE_OF_TAB[selected] });
  const siteId = await resolveLiveBranchId({ actor, organizationId, branchId });
  const branch = await Branch.findById(siteId).select("name timezone").lean();
  const timezone = branch?.timezone || DEFAULT_TZ;
  const week = weekOf(date, timezone, now);

  const [header, body] = await Promise.all([
    headerOf({ actor, timezone, now }),
    selected === "full"
      ? fullRota({ branchId: siteId, week, timezone })
      : whosIn({ branchId: siteId, timezone, page, limit, skip, now }),
  ]);

  return {
    tab: selected,
    header,
    branch: { _id: siteId, name: branch?.name || "" },
    week: {
      from: week.start.format(DAY),
      to: week.end.clone().subtract(1, "day").format(DAY),
      label: `Week of ${week.start.format("D MMM")}`,
    },
    ...body,
  };
};

module.exports = { getRotaScreen };
