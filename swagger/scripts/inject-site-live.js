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

const branchQuery = {
  name: "branchId",
  in: "query",
  required: false,
  schema: { type: "string" },
};

spec.paths["/app/site-live"] = {
  get: {
    tags: ["site-live"],
    summary: "Site Manager Live home",
    description:
      "One payload for Site Live: on-site counts, active evacuation, walk-ins awaiting approval, planned visits, kiosks, own attendance status, recent activity preview (5). Roles: superAdmin, owner, siteManager.",
    security: bearer,
    parameters: [orgHeader, branchQuery],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

spec.paths["/app/site-live/activity"] = {
  get: {
    tags: ["site-live"],
    summary: "Site Live recent activity (See All)",
    description:
      "Same rows as home recentActivity.items, paginated. Last 30 days. Roles: superAdmin, owner, siteManager.",
    security: bearer,
    parameters: [
      orgHeader,
      branchQuery,
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
    ],
    responses: { 200: ok, 403: { description: "Role not allowed" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/site-live/activity"] = {
  get: {
    tags: ["site-live"],
    summary: "Site Live recent activity (admin org scope)",
    security: bearer,
    parameters: [
      {
        name: "organizationId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      branchQuery,
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
    ],
    responses: { 200: ok },
  },
};

spec.paths["/admin/organizations/{organizationId}/site-live"] = {
  get: {
    tags: ["site-live"],
    summary: "Site Manager Live home (admin org scope)",
    security: bearer,
    parameters: [
      {
        name: "organizationId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      branchQuery,
    ],
    responses: { 200: ok },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("injected site live swagger");
