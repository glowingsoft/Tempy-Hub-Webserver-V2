const fs = require("fs");

const FILE = "./swagger/swagger_output.json";
const spec = JSON.parse(fs.readFileSync(FILE, "utf8"));

const bearer = [{ bearerAuth: [] }];
const ok = {
  description: "OK",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiResponse" },
    },
  },
};

const orgHeader = {
  name: "x-org-id",
  in: "header",
  required: true,
  schema: { type: "string" },
};

const periodQuery = {
  name: "period",
  in: "query",
  required: false,
  schema: { type: "string", enum: ["daily", "weekly", "monthly"], default: "daily" },
};

const orgPath = {
  name: "organizationId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

spec.paths["/app/team-live"] = {
  get: {
    tags: ["team-live"],
    summary: "Line Manager Team home",
    description:
      "Team Progress, on-site chip, pending leave, next-14-day rota preview, own status, recent activity (5). Role: lineManager. Direct reports only.",
    security: bearer,
    parameters: [orgHeader, periodQuery],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

spec.paths["/app/team-live/activity"] = {
  get: {
    tags: ["team-live"],
    summary: "Team Live recent activity (See All)",
    description:
      "Clock in/out, late, leave request/approve/reject for direct reports. Last 30 days. Role: lineManager.",
    security: bearer,
    parameters: [
      orgHeader,
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
    ],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/team-live/activity"] = {
  get: {
    tags: ["team-live"],
    summary: "Team Live activity (admin org scope)",
    security: bearer,
    parameters: [
      orgPath,
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
    ],
    responses: { 200: ok },
  },
};

spec.paths["/admin/organizations/{organizationId}/team-live"] = {
  get: {
    tags: ["team-live"],
    summary: "Line Manager Team home (admin org scope)",
    security: bearer,
    parameters: [orgPath, periodQuery],
    responses: { 200: ok },
  },
};

spec.paths["/app/line-home"] = {
  get: {
    tags: ["line-home"],
    summary: "Line Manager Team home",
    description:
      "My Team Today, This Month and Recent Activity cards in one call. Role: lineManager. Name, photo, site and role come from login. Today and This Month are direct reports; family photos and restricted residents are the site. activity.ownShifts is the My Own Shifts card {next, upcoming, hoursThisWeek, pendingLeave}; tap GET /app/shifts/my. See All stays GET /app/team-live/activity. tempyAgency.bids is always null (no bids store).",
    security: bearer,
    parameters: [orgHeader],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/line-home"] = {
  get: {
    tags: ["line-home"],
    summary: "Line Manager Team home (admin org scope)",
    description:
      "Same payload as GET /app/line-home. Role: lineManager.",
    security: bearer,
    parameters: [orgPath],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

const todayTab = {
  name: "tab",
  in: "query",
  required: false,
  schema: { type: "string", enum: ["onShift", "checkedIn", "late", "sick"], default: "onShift" },
};

spec.paths["/app/line-home/today"] = {
  get: {
    tags: ["line-home"],
    summary: "My Team Today list",
    description:
      "On Shift / Checked-in / Late / Sick people for direct reports. Query tab (default onShift; 400 invalid_today_tab). data is the active tab only. meta.counts has all four chip totals (unique people). meta.uncoveredNightShift is true when an open night shift (starts 18:00 or later, site timezone) has no staff. Each row: staffId, name, photoUrl, jobTitle, startsAt, endsAt, clockInAt, lateMinutes, sickReportedAt, clockedIn. Role: lineManager.",
    security: bearer,
    parameters: [
      orgHeader,
      todayTab,
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
    ],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/line-home/today"] = {
  get: {
    tags: ["line-home"],
    summary: "My Team Today list (admin org scope)",
    description: "Same payload as GET /app/line-home/today. Role: lineManager.",
    security: bearer,
    parameters: [
      orgPath,
      todayTab,
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
    ],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("injected team live swagger");
