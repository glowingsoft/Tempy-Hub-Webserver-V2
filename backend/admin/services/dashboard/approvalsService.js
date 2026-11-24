const { AppError } = require("@services/_errors/AppError");
const { ModuleSlug } = require("@models/domainEnums");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const familyVisitService = require("@adminServices/family/familyVisitStaffService");
const familyModerationService = require("@adminServices/family/familyModerationService");
const familyStaffService = require("@adminServices/family/familyStaffService");
const shiftService = require("@adminServices/rota/shiftService");
const leaveService = require("@adminServices/leave/leaveService");

const TAB_NAMES = ["visitors", "shifts", "leave", "photos", "joins"];
const LEAVE_LABELS = {
  annual: "Holiday",
  sick: "Sickness",
  absence: "Absence",
  unpaid: "Unpaid Leave",
  compassionate: "Compassionate Leave",
  parental: "Parental Leave",
  other: "Leave",
};

const moduleIsActive = (organization, moduleSlug, isPlatformAdmin) =>
  isPlatformAdmin ||
  (organization?.moduleAccess || []).some(
    (module) =>
      module.moduleSlug === moduleSlug &&
      module.enabled &&
      (!module.expiresAt || new Date(module.expiresAt) > new Date()),
  );

const availableTabs = ({ organization, isPlatformAdmin }) => {
  const family = isFamilyModuleActive(organization) || isPlatformAdmin;
  return {
    visitors: family,
    shifts: moduleIsActive(
      organization,
      ModuleSlug.ROTA_SCHEDULING,
      isPlatformAdmin,
    ),
    leave: moduleIsActive(organization, ModuleSlug.LEAVE, isPlatformAdmin),
    photos: family,
    joins: family,
  };
};

const timestampOf = (row) =>
  row.createdAt || row.requestedAt || row.startAt || row.startDate || null;

const shortDate = (value, { weekday = false } = {}) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    ...(weekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
};

const shortTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value));
};

const dayDistanceFromNow = (value, now = new Date()) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  const date = new Date(value);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((targetUtc - todayUtc) / 86_400_000);
};

const cardFor = (tab, row, now) => {
  if (tab === "visitors") {
    const requester = row.requestedBy?.name || "Family member";
    return {
      title: `Visit Request · ${shortDate(row.startAt, { weekday: true })}`,
      subtitle: `${requester} · ${row.partySize || 1} People · ${row.residentName || "Resident"}`,
      badges: ["Request"],
    };
  }

  if (tab === "shifts") {
    const date = shortDate(row.shift?.startsAt, { weekday: true });
    const start = shortTime(row.shift?.startsAt);
    const end = shortTime(row.shift?.endsAt);
    return {
      title: `Shift Claim · ${[date, start && end ? `${start}–${end}` : ""].filter(Boolean).join(" ")}`,
      subtitle: [row.staff?.name, row.branch?.name].filter(Boolean).join(" · "),
      badges: ["Claim"],
    };
  }

  if (tab === "leave") {
    const label = LEAVE_LABELS[row.leaveType] || "Leave";
    const start = shortDate(row.startDate);
    const end = shortDate(row.endDate);
    const daysUntil = dayDistanceFromNow(row.startDate, now);
    const range = start && end && start !== end ? `${start}–${end}` : start;
    const subtitle = [
      row.staff?.name,
      `${row.totalDays || 0} Days`,
      daysUntil == null ? "" : daysUntil <= 0 ? "From Today" : `${daysUntil} Days Left`,
    ].filter(Boolean).join(" · ");
    return {
      title: `${label} · ${range}`,
      subtitle,
      badges: [row.leaveType === "sick" ? "Sickness" : "Leave"],
    };
  }

  if (tab === "photos") {
    const count = Array.isArray(row.photos) ? row.photos.length : 0;
    const relationship = row.authorRelationship
      ? row.authorRelationship.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())
      : "Family Member";
    return {
      title: `${row.residentName || "Resident"}${row.roomNumber ? ` · RM ${row.roomNumber}` : ""}`,
      subtitle: `${count} ${count === 1 ? "Photo" : "Photos"} From ${row.authorName || "Family Member"} · ${relationship}`,
      badges: ["Pending", ...(row.residentHasPhotoConsent ? [] : ["No Consent"])],
      photoUrl: row.residentPhotoUrl || row.authorPhotoUrl || "",
      photos: row.photos || [],
    };
  }

  const daysWaiting = dayDistanceFromNow(row.requestedAt, now);
  const escalated = daysWaiting != null && daysWaiting >= 7;
  return {
    title: `${row.name || "Family member"} wants to join ${row.residentName || "resident"}'s family`,
    subtitle: escalated
      ? `Next of kin hasn't answered in ${daysWaiting} days`
      : [row.relationship, shortDate(row.requestedAt)].filter(Boolean).join(" · "),
    badges: [escalated ? "Escalated" : "Pending"],
  };
};

const shapeItem = (tab, row, now) => ({
  ...row,
  id: row.id || row._id || row.requestId || row.uploadId,
  tab,
  status: row.status || (tab === "visitors" ? "requested" : "pending"),
  createdAt: timestampOf(row),
  card: cardFor(tab, row, now),
});

const listSiteApprovals = async ({
  actor,
  organizationId,
  organization,
  isPlatformAdmin,
  branchId,
  tab = "all",
  page = 1,
  limit = 20,
  skip = (page - 1) * limit,
  now = new Date(),
}) => {
  const selectedTab = String(tab || "all")
    .trim()
    .toLowerCase();
  if (selectedTab !== "all" && !TAB_NAMES.includes(selectedTab)) {
    throw new AppError("invalid_approval_tab", 400, {
      validTabs: ["all", ...TAB_NAMES].join(","),
    });
  }

  const availability = availableTabs({ organization, isPlatformAdmin });
  if (selectedTab !== "all" && !availability[selectedTab]) {
    throw new AppError("approval_tab_module_not_enabled", 403);
  }

  const tabs =
    selectedTab === "all"
      ? TAB_NAMES.filter((name) => availability[name])
      : [selectedTab];
  if (selectedTab === "all" && page * limit > 500) {
    throw new AppError("approval_page_out_of_range", 400);
  }
  const candidateLimit =
    selectedTab === "all" ? Math.min(page * limit, 500) : limit;
  const candidatePage = selectedTab === "all" ? 1 : page;
  const candidateSkip = selectedTab === "all" ? 0 : skip;
  const common = {
    actor,
    organizationId,
    branchId,
    page: candidatePage,
    limit: candidateLimit,
    skip: candidateSkip,
  };

  const load = {
    visitors: () =>
      familyVisitService.listVisits({
        ...common,
        status: "requested",
        range: "upcoming",
        withVisiting: false,
      }),
    shifts: () => shiftService.listClaims({ ...common, status: "pending" }),
    leave: () =>
      leaveService.listLeaveRequests({ ...common, status: "pending" }),
    photos: () =>
      familyModerationService.listUploads({
        organizationId,
        branchId,
        status: "pending",
        page: candidatePage,
        limit: candidateLimit,
        skip: candidateSkip,
      }),
    joins: () => familyStaffService.listJoinRequests(common),
  };

  const results = await Promise.all(
    tabs.map(async (name) => [name, await load[name]()]),
  );
  const resultByTab = new Map(results);
  const counts = Object.fromEntries(
    TAB_NAMES.map((name) => {
      const meta = resultByTab.get(name)?.meta;
      return [name, meta?.totalRecords ?? meta?.total ?? 0];
    }),
  );
  const rows = results.flatMap(([name, result]) =>
    (result.data || []).map((row) => shapeItem(name, row, now)),
  );

  if (selectedTab === "all") {
    rows.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
  }

  const totalRecords =
    selectedTab === "all"
      ? Object.values(counts).reduce((sum, count) => sum + count, 0)
      : counts[selectedTab];
  const data = selectedTab === "all" ? rows.slice(skip, skip + limit) : rows;

  return {
    data,
    meta: {
      tab: selectedTab,
      currentPage: page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      counts,
      availableTabs: ["all", ...TAB_NAMES.filter((name) => availability[name])],
    },
  };
};

module.exports = { listSiteApprovals };
