/**
 * Team Compliance screen: supervision, appraisal, competency and training for one team.
 * Line managers see their direct reports and supervisees on their site, site managers their site,
 * owners the site they pick. Scores reuse complianceSnapshot, so they match the dashboards.
 */
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { AppError } = require("@services/_errors/AppError");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { Department } = require("@models/Department");
const { JobTitle } = require("@models/JobTitle");
const {
  MembershipRole,
  StaffProfileStatus,
  RequirementType,
} = require("@models/domainEnums");
const { generateMeta } = require("@utils/responseUtil");
const {
  actorStanding,
  scopeBranchFilter,
  lineTeamMatch,
} = require("@adminServices/staff/staffAccess");
const {
  showable,
  renderTemplate,
  TEMPLATE_ROOT,
} = require("@adminServices/family/familyPdfKit");
const { htmlToPdf } = require("@adminServices/family/familyPdfRenderer");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { complianceSnapshot } = require("./ownerDashboardService");

const MEETING_TABS = ["supervision", "appraisal"];
const REQUIREMENT_TABS = {
  competency: RequirementType.COMPETENCY,
  training: RequirementType.TRAINING,
};
const TABS = [...MEETING_TABS, ...Object.keys(REQUIREMENT_TABS)];
const TAB_LABELS = {
  supervision: "Supervision",
  appraisal: "Appraisal",
  competency: "Competency",
  training: "Training",
};

/** Badge colours, in one place so the app, CSV and PDF agree. */
const GREEN_FROM = 90;
const AMBER_FROM = 70;

/** 0 when nothing is due; level then says "notDue" so the app can tell it from a real 0%. */
const percentOf = (done, expected) =>
  expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0;

const levelOf = (done, expected) => {
  if (!expected) return "notDue";
  const percent = percentOf(done, expected);
  if (percent >= GREEN_FROM) return "green";
  if (percent >= AMBER_FROM) return "amber";
  return "red";
};

/** Optional id from the query string: null when absent, 400 when malformed. */
const optionalId = (value, errorKey) => {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^[a-f\d]{24}$/i.test(text)) throw new AppError(errorKey, 400);
  return new mongoose.Types.ObjectId(text);
};

const parseTabs = (tab) => {
  const value = String(tab ?? "").trim();
  if (!value || value === "all") return TABS;
  if (!TABS.includes(value)) throw new AppError("invalid_compliance_tab", 400);
  return [value];
};

/** The caller's site and every active team member on it, in at most three queries. */
const loadTeam = async ({ actor, organizationId, branchId }) => {
  const orgId = optionalId(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  if (standing.role === MembershipRole.STAFF) {
    throw new AppError("insufficient_role", 403);
  }
  const siteId = optionalId(
    scopeBranchFilter(standing, branchId),
    "invalid_branch_id",
  );
  if (!siteId) throw new AppError("branch_scope_required", 400);

  const isLineManager = standing.role === MembershipRole.LINE_MANAGER;
  const [branch, manager] = await Promise.all([
    Branch.findOne({ _id: siteId, organizationId: orgId })
      .select("name timezone")
      .lean(),
    isLineManager
      ? StaffProfile.findOne({ userId: actor._id, organizationId: orgId })
          .select("_id")
          .lean()
      : null,
  ]);
  if (!branch) throw new AppError("branch_not_found", 404);

  const base = { orgId, siteId, branch, isLineManager };
  if (isLineManager && !manager) return { ...base, team: [] };

  const team = await StaffProfile.aggregate([
    {
      $match: {
        organizationId: orgId,
        branchId: siteId,
        status: StaffProfileStatus.ACTIVE,
        // Line manager team: direct reports plus the staff they supervise.
        ...(isLineManager ? lineTeamMatch(manager._id) : {}),
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        pipeline: [{ $project: { name: 1, profileIcon: 1 } }],
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        jobTitleId: 1,
        departmentIds: 1,
        name: { $ifNull: ["$user.name", ""] },
        photoUrl: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$photoUrl", ""] } }, 0] },
            "$photoUrl",
            { $ifNull: ["$user.profileIcon", ""] },
          ],
        },
      },
    },
  ]);
  return { ...base, team };
};

/** Dropdown filter: one job title or one person. */
const applyFilter = ({ team, isLineManager, jobTitleId, staffId }) => {
  const jobTitle = optionalId(jobTitleId, "invalid_job_title_id");
  const staff = optionalId(staffId, "invalid_staff_profile_id");
  if (jobTitle && staff) throw new AppError("invalid_compliance_filter", 400);

  if (staff) {
    const members = team.filter((row) => String(row._id) === String(staff));
    if (!members.length) {
      throw isLineManager
        ? new AppError("not_direct_report", 403)
        : new AppError("staff_profile_not_found", 404);
    }
    return members;
  }
  if (jobTitle) {
    return team.filter((row) => String(row.jobTitleId) === String(jobTitle));
  }
  return team;
};

const uniqueIds = (values) => [
  ...new Map(
    values.filter(Boolean).map((id) => [String(id), id]),
  ).values(),
];

const byName = (a, b) => a.name.localeCompare(b.name);

/** Worst first; "not due" last; then by name. */
const worstFirst = (a, b) =>
  (a.level === "notDue") - (b.level === "notDue") ||
  a.percent - b.percent ||
  byName(a, b);

const addTo = (map, key, extra, done, expected) => {
  const row = map.get(key) || { ...extra, done: 0, expected: 0 };
  row.done += done;
  row.expected += expected;
  map.set(key, row);
};

/** Per person { done, expected } for one tab, plus per course / competency for requirement tabs. */
const tabTotals = (tab, snapshot) => {
  const totals = new Map();
  const items = new Map();
  const { staff, cells, supervisionStandings, appraisalStandings } =
    snapshot.detail;

  if (MEETING_TABS.includes(tab)) {
    const standings =
      tab === "supervision" ? supervisionStandings : appraisalStandings;
    staff.forEach((member, index) => {
      const { completed, required } = standings[index];
      totals.set(String(member._id), {
        done: Math.min(completed, required),
        expected: required,
        // Every completed meeting, including early ones that are not due yet.
        completed,
      });
    });
    return { totals, items: null };
  }

  cells
    .filter((row) => row.type === REQUIREMENT_TABS[tab] && row.cell.expected)
    .forEach((row) => {
      const met = row.cell.met ? 1 : 0;
      addTo(totals, String(row.staffId), {}, met, 1);
      addTo(
        items,
        String(row.requirementId),
        { requirementId: row.requirementId, name: row.name },
        met,
        1,
      );
    });
  return { totals, items };
};

const withPercent = ({ done, expected, ...rest }) => {
  const percent = percentOf(done, expected);
  return { ...rest, done, expected, percent, level: levelOf(done, expected) };
};

const buildSection = ({ tab, snapshot, members, departmentNames }) => {
  const { totals, items } = snapshot
    ? tabTotals(tab, snapshot)
    : { totals: new Map(), items: MEETING_TABS.includes(tab) ? null : new Map() };

  const departments = new Map();
  let done = 0;
  let expected = 0;
  const staff = members.map((member) => {
    const total = totals.get(String(member._id)) || {
      done: 0,
      expected: 0,
      ...(MEETING_TABS.includes(tab) ? { completed: 0 } : {}),
    };
    done += total.done;
    expected += total.expected;
    (member.departmentIds || []).forEach((id) => {
      const name = departmentNames.get(String(id));
      if (name) {
        addTo(departments, String(id), { departmentId: id, name }, total.done, total.expected);
      }
    });
    return withPercent({
      staffId: member._id,
      name: member.name,
      photoUrl: member.photoUrl,
      ...total,
    });
  });

  return {
    summary: withPercent({ done, expected }),
    // A department with nothing due yet has no bar to show.
    byDepartment: [...departments.values()]
      .filter((row) => row.expected > 0)
      .map(withPercent)
      .sort(byName),
    ...(items ? { byItem: [...items.values()].map(withPercent).sort(byName) } : {}),
    staff: staff.sort(worstFirst),
  };
};

/** Everything the screen and the export need, from one snapshot. */
const buildTeamCompliance = async ({
  actor,
  organizationId,
  branchId,
  jobTitleId,
  staffId,
  tab,
  withFilters = false,
  now = new Date(),
}) => {
  const tabs = parseTabs(tab);
  const { orgId, siteId, branch, isLineManager, team } = await loadTeam({
    actor,
    organizationId,
    branchId,
  });
  const members = applyFilter({ team, isLineManager, jobTitleId, staffId });

  const departmentIds = uniqueIds(members.flatMap((row) => row.departmentIds || []));
  const jobTitleIds = withFilters ? uniqueIds(team.map((row) => row.jobTitleId)) : [];

  const [snapshot, departments, jobTitles] = await Promise.all([
    members.length
      ? complianceSnapshot({
          organization: orgId,
          branchZones: new Map([[String(siteId), branch.timezone]]),
          now,
          branchId: siteId,
          staffIds: members.map((row) => row._id),
        })
      : null,
    departmentIds.length
      ? Department.find({ _id: { $in: departmentIds } }).select("name").lean()
      : [],
    jobTitleIds.length
      ? JobTitle.find({ _id: { $in: jobTitleIds } }).select("name").lean()
      : [],
  ]);

  const departmentNames = new Map(
    departments.map((row) => [String(row._id), row.name]),
  );
  const sections = Object.fromEntries(
    tabs.map((name) => [
      name,
      buildSection({ tab: name, snapshot, members, departmentNames }),
    ]),
  );

  return {
    siteName: branch.name || "",
    tabs,
    total: members.length,
    sections,
    ...(withFilters
      ? {
          filters: {
            roles: jobTitles
              .map((row) => ({ jobTitleId: row._id, name: row.name }))
              .sort(byName),
            staff: team
              .map((row) => ({ staffId: row._id, name: row.name }))
              .sort(byName),
          },
        }
      : {}),
  };
};

const getTeamCompliance = async ({ page, limit, skip, ...scope }) => {
  const report = await buildTeamCompliance({ ...scope, withFilters: page === 1 });

  const data = {
    ...(report.filters ? { filters: report.filters } : {}),
    scores: Object.fromEntries(
      report.tabs.map((name) => [name, report.sections[name].summary.percent]),
    ),
  };
  report.tabs.forEach((name) => {
    const { summary, staff, ...section } = report.sections[name];
    data[name] = { ...section, staff: staff.slice(skip, skip + limit) };
  });

  return { data, meta: generateMeta(page, limit, report.total) };
};

/* ---------- Export ---------- */

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvLine = (cells) => cells.map(csvCell).join(",");
const percentText = (row) =>
  row.level === "notDue" ? "Not due" : `${row.percent}%`;
const ITEM_LABEL = { competency: "Competency", training: "Course" };

const teamComplianceCsv = (report) => {
  const lines = [];
  report.tabs.forEach((name) => {
    const section = report.sections[name];
    lines.push(
      csvLine([TAB_LABELS[name], percentText(section.summary)]),
      csvLine(["Department", "Percent"]),
      ...section.byDepartment.map((row) => csvLine([row.name, percentText(row)])),
    );
    if (section.byItem) {
      lines.push(
        csvLine([ITEM_LABEL[name], "Percent"]),
        ...section.byItem.map((row) => csvLine([row.name, percentText(row)])),
      );
    }
    lines.push(
      csvLine(["Name", "Done", "Expected", "Percent"]),
      ...section.staff.map((row) =>
        csvLine([row.name, row.done, row.expected, percentText(row)]),
      ),
      "",
    );
  });
  return `﻿${lines.join("\r\n")}`;
};

const sans = (value) => showable("Sans", value);
const pdfBar = (row) => ({
  name: sans(row.name),
  value: percentText(row),
  width: row.percent,
  low: row.level === "red",
});

const teamCompliancePdf = async (report, day) => {
  const home = sans(report.siteName || "Your site");
  const dateLabel = moment.utc(day).format("D MMMM YYYY");
  const html = renderTemplate(
    "teamCompliance",
    {
      title: showable("Serif-Bold", "Team Compliance"),
      siteName: home,
      dateLabel,
      footerLabel: `${home} - ${dateLabel} - Sent with TempyHub`,
      sections: report.tabs.map((name) => {
        const section = report.sections[name];
        return {
          label: sans(TAB_LABELS[name]),
          score: percentText(section.summary),
          low: section.summary.level === "red",
          departments: section.byDepartment.map(pdfBar),
          itemLabel: ITEM_LABEL[name] || "",
          items: (section.byItem || []).map(pdfBar),
          staff: section.staff.map((row) => ({
            ...pdfBar(row),
            done: `${row.done} of ${row.expected}`,
          })),
        };
      }),
    },
    TEMPLATE_ROOT,
  );
  return (await htmlToPdf(html)).buffer;
};

const uploadExport = async ({ day, format, body, contentType }) => {
  const filename = `team-compliance-${day}.${format}`;
  const key = `compliance-exports/${randomUUID()}.${format}`;
  await uploadAwsService.putObject({ key, body, contentType });
  const { token, expiresAt } = uploadAwsService.createShortDownloadToken({
    key,
    filename,
    contentType,
  });
  return { token, expiresAt, filename };
};

/** Same filter and tab as the screen, all rows, CSV and PDF together. */
const exportTeamCompliance = async (scope) => {
  const report = await buildTeamCompliance(scope);
  const day = moment.utc(scope.now ?? new Date()).format("YYYY-MM-DD");
  const pdfBody = await teamCompliancePdf(report, day);

  const [csv, pdf] = await Promise.all([
    uploadExport({
      day,
      format: "csv",
      body: Buffer.from(teamComplianceCsv(report), "utf8"),
      contentType: "text/csv; charset=utf-8",
    }),
    uploadExport({ day, format: "pdf", body: pdfBody, contentType: "application/pdf" }),
  ]);
  return { csv, pdf };
};

module.exports = {
  getTeamCompliance,
  exportTeamCompliance,
  buildTeamCompliance,
  teamComplianceCsv,
};
