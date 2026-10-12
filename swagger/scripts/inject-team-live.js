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

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("injected team live swagger");
