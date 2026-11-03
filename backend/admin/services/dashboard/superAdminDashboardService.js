const { AppError } = require("@services/_errors/AppError");
const {
  toObjectId,
  isValidObjectId,
} = require("@appServices/family/familyPipeline");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { Membership } = require("@models/Membership");
const { StaffProfile } = require("@models/StaffProfile");
const { Resident } = require("@models/Resident");
const { ExternalPerson } = require("@models/ExternalPerson");
const { StaffInvitation } = require("@models/StaffInvitation");
const { OrganizationUsage } = require("@models/OrganizationUsage");
const { UsageSnapshot } = require("@models/UsageSnapshot");
const {
  ActiveInactiveStatus,
  AdmissionStatus,
  ExternalPersonType,
  MembershipRole,
  StaffInvitationStatus,
  StaffProfileStatus,
} = require("@models/domainEnums");
const {
  toGb,
  getBilling,
} = require("@adminServices/billing/billingUsageService");

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
const TOP_ORGANIZATIONS = 5;
const MANAGER_ROLES = [
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
];

const percentOf = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

const countOf = async (model, match) => {
  const [row] = await model.aggregate([{ $match: match }, { $count: "count" }]);
  return row?.count ?? 0;
};

const modulesOf = (organization, now) =>
  (organization.moduleAccess || []).filter(
    (module) =>
      module.enabled && (!module.expiresAt || new Date(module.expiresAt) > now),
  ).length;

const cumulativeByMonth = async (model, match, year, now) => {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await model.aggregate([
    { $match: { ...match, createdAt: { $lt: yearEnd } } },
    {
      $group: {
        _id: {
          $cond: [
            { $lt: ["$createdAt", yearStart] },
            0,
            { $month: "$createdAt" },
          ],
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const at = (month) => rows.find((row) => row._id === month)?.count ?? 0;
  let running = at(0);
  return MONTHS.map((_, index) => {
    running += at(index + 1);
    const future =
      year > now.getUTCFullYear() ||
      (year === now.getUTCFullYear() && index > now.getUTCMonth());
    return future ? null : running;
  });
};

const usageOf = async () => {
  const [totals] = await OrganizationUsage.aggregate([
    {
      $group: {
        _id: null,
        imageBytes: { $sum: "$imageBytes" },
        fileBytes: { $sum: "$fileBytes" },
      },
    },
  ]);
  return {
    imageBytes: totals?.imageBytes ?? 0,
    fileBytes: totals?.fileBytes ?? 0,
  };
};

const sharesOf = ({ imageBytes, fileBytes }) => {
  const used = imageBytes + fileBytes;
  return {
    gb: toGb(used),
    images: {
      gb: toGb(imageBytes),
      percentOfUsed: percentOf(imageBytes, used),
    },
    files: { gb: toGb(fileBytes), percentOfUsed: percentOf(fileBytes, used) },
  };
};

const getDashboard = async ({ organizationId, year, now = new Date() }) => {
  const selectedYear = year === undefined ? now.getUTCFullYear() : year;
  if (
    !Number.isInteger(selectedYear) ||
    selectedYear < 2000 ||
    selectedYear > 2100
  )
    throw new AppError("invalid_statistics_year", 400);

  const organizations = await Organization.aggregate([
    { $project: { name: 1, status: 1, moduleAccess: 1 } },
  ]);
  const orgIds = organizations.map((organization) => organization._id);
  const inOrganizations = { organizationId: { $in: orgIds } };

  const ranked = organizations
    .map((organization) => ({
      organizationId: organization._id,
      name: organization.name,
      status: organization.status,
      modules: modulesOf(organization, now),
    }))
    .sort((a, b) => b.modules - a.modules || a.name.localeCompare(b.name));

  let selected = ranked[0] || null;
  if (organizationId) {
    if (!isValidObjectId(organizationId))
      throw new AppError("organization_not_found", 404);
    selected = ranked.find(
      (organization) =>
        String(organization.organizationId) === String(organizationId),
    );
    if (!selected) throw new AppError("organization_not_found", 404);
  }

  const branches = await Branch.aggregate([
    { $match: inOrganizations },
    { $project: { _id: 1 } },
  ]);
  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);

  const [
    pendingInvitations,
    professionals,
    managers,
    staff,
    residents,
    organizationSeries,
    siteSeries,
    organizationsYearAgo,
    sitesYearAgo,
    usage,
    snapshots,
    billing,
  ] = await Promise.all([
    countOf(StaffInvitation, {
      status: StaffInvitationStatus.PENDING,
      expiresAt: { $gt: now },
    }),
    countOf(ExternalPerson, {
      branchId: { $in: branches.map((branch) => branch._id) },
      type: ExternalPersonType.PROFESSIONAL,
    }),
    countOf(Membership, {
      ...inOrganizations,
      role: { $in: MANAGER_ROLES },
      status: ActiveInactiveStatus.ACTIVE,
    }),
    countOf(StaffProfile, {
      ...inOrganizations,
      status: StaffProfileStatus.ACTIVE,
    }),
    countOf(Resident, {
      ...inOrganizations,
      admissionStatus: AdmissionStatus.ADMITTED,
    }),
    cumulativeByMonth(Organization, {}, selectedYear, now),
    cumulativeByMonth(Branch, inOrganizations, selectedYear, now),
    countOf(Organization, { createdAt: { $lt: yearAgo } }),
    countOf(Branch, { ...inOrganizations, createdAt: { $lt: yearAgo } }),
    usageOf(),
    UsageSnapshot.aggregate([
      { $match: { month: { $regex: `^${selectedYear}-` } } },
      { $project: { _id: 0, month: 1, imageBytes: 1, fileBytes: 1 } },
    ]),
    getBilling(),
  ]);

  const before = organizationsYearAgo + sitesYearAgo;
  const nowTotal = organizations.length + branches.length;

  const overview = selected
    ? await (async () => {
        const own = { organizationId: toObjectId(selected.organizationId) };
        const [sites, staffCount, residentCount, siteManagers, lineManagers] =
          await Promise.all([
            countOf(Branch, own),
            countOf(StaffProfile, {
              ...own,
              status: StaffProfileStatus.ACTIVE,
            }),
            countOf(Resident, {
              ...own,
              admissionStatus: AdmissionStatus.ADMITTED,
            }),
            countOf(Membership, {
              ...own,
              role: MembershipRole.SITE_MANAGER,
              status: ActiveInactiveStatus.ACTIVE,
            }),
            countOf(Membership, {
              ...own,
              role: MembershipRole.LINE_MANAGER,
              status: ActiveInactiveStatus.ACTIVE,
            }),
          ]);
        return {
          organizationId: selected.organizationId,
          name: selected.name,
          sites,
          staff: staffCount,
          residents: residentCount,
          modules: selected.modules,
          siteManagers,
          lineManagers,
        };
      })()
    : null;

  const byMonth = new Map(
    snapshots.map((snapshot) => [snapshot.month, snapshot]),
  );
  const currentMonth =
    now.getUTCFullYear() === selectedYear ? now.getUTCMonth() : -1;
  const months = MONTHS.map((month, index) => {
    const key = `${selectedYear}-${String(index + 1).padStart(2, "0")}`;
    const figures = index === currentMonth ? usage : byMonth.get(key);
    if (!figures)
      return { month, imagesGb: null, filesGb: null, totalGb: null };
    return {
      month,
      imagesGb: toGb(figures.imageBytes),
      filesGb: toGb(figures.fileBytes),
      totalGb: toGb(figures.imageBytes + figures.fileBytes),
    };
  });

  const planQuotaGb = billing.planLimitGb
    ? billing.planLimitGb * organizations.length
    : null;
  const used = sharesOf(usage);

  return {
    summary: {
      organizations: organizations.length,
      sites: branches.length,
      pendingInvitations,
      professionals,
      siteAndLineManagers: managers,
      staff,
      residents,
      totalMonthlyRevenueGbp: null,
    },
    onboardingGrowth: {
      year: selectedYear,
      months: MONTHS,
      organizations: organizationSeries,
      sites: siteSeries,
      changePercent: before
        ? Math.round(((nowTotal - before) / before) * 100)
        : null,
    },
    topOrganizations: ranked.slice(0, TOP_ORGANIZATIONS),
    revenueByOrganization: ranked.map(({ organizationId: id, name }) => ({ organizationId: id, name, monthlyRevenueGbp: null })),
    organizations: ranked.map(({ organizationId: id, name }) => ({
      organizationId: id,
      name,
    })),
    organizationOverview: overview,
    dataUsage: {
      year: selectedYear,
      usedGb: used.gb,
      planQuotaGb,
      quotaPercent: planQuotaGb
        ? percentOf(usage.imageBytes + usage.fileBytes, planQuotaGb * 1024 ** 3)
        : null,
      images: used.images,
      files: used.files,
      months,
    },
  };
};

module.exports = { getDashboard };
