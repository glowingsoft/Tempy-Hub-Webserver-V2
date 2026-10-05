const fs = require("fs");

const FILE = "./swagger/swagger_output.json";
const spec = JSON.parse(fs.readFileSync(FILE, "utf8"));

const bearer = [{ bearerAuth: [] }];
const orgHeader = {
  name: "x-org-id",
  in: "header",
  required: true,
  schema: { type: "string" },
};
const pagination = [
  { name: "page", in: "query", schema: { type: "integer", default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
];
const ok = {
  description: "OK",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiResponse" },
    },
  },
};
const rotaTag = ["Rota"];

if (!spec.tags.find((t) => t.name === "Rota")) {
  spec.tags.push({
    name: "Rota",
    description: "Shifts, open shifts, and shift claims (rotaScheduling module).",
  });
}

spec.paths["/admin/organizations/{organizationId}/shifts"] = {
  post: {
    tags: rotaTag,
    summary: "Create shift",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ShiftCreateRequest" },
        },
      },
    },
    responses: { 201: ok, 400: { description: "Bad request" }, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
  get: {
    tags: rotaTag,
    summary: "List shifts",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "status", in: "query", schema: { type: "string" } },
      { name: "staffId", in: "query", schema: { type: "string" } },
      { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
    ],
    responses: { 200: ok, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/shifts/{shiftId}"] = {
  get: {
    tags: rotaTag,
    summary: "Get shift",
    security: bearer,
    parameters: [
      { name: "shiftId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
  patch: {
    tags: rotaTag,
    summary: "Update shift",
    security: bearer,
    parameters: [
      { name: "shiftId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ShiftUpdateRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Bad request" }, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/shift-claims"] = {
  get: {
    tags: rotaTag,
    summary: "List shift claims",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "status", in: "query", schema: { type: "string" } },
      { name: "shiftId", in: "query", schema: { type: "string" } },
    ],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/shift-claims/{claimId}/approve"] = {
  post: {
    tags: rotaTag,
    summary: "Approve shift claim",
    security: bearer,
    parameters: [
      { name: "claimId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/shift-claims/{claimId}/reject"] = {
  post: {
    tags: rotaTag,
    summary: "Reject shift claim",
    security: bearer,
    parameters: [
      { name: "claimId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
  },
};

spec.paths["/app/shifts/my"] = {
  get: {
    tags: rotaTag,
    summary: "My assigned shifts",
    security: bearer,
    parameters: [
      orgHeader,
      { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
    ],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/shifts/open"] = {
  get: {
    tags: rotaTag,
    summary: "Open shifts available to claim",
    security: bearer,
    parameters: [orgHeader],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/shifts/active"] = {
  get: {
    tags: rotaTag,
    summary: "Current shift for clock-in eligibility",
    security: bearer,
    parameters: [orgHeader],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/shifts/{shiftId}/claims"] = {
  post: {
    tags: rotaTag,
    summary: "Claim an open shift",
    security: bearer,
    parameters: [
      { name: "shiftId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 201: ok, 400: { description: "Bad request" }, 403: { description: "Forbidden" }, 409: { description: "Already claimed" } },
  },
};

spec.paths["/app/shift-claims/{claimId}/withdraw"] = {
  post: {
    tags: rotaTag,
    summary: "Withdraw a pending shift claim",
    security: bearer,
    parameters: [
      { name: "claimId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.components.schemas.ShiftCreateRequest = {
  type: "object",
  required: ["branchId", "startsAt", "endsAt"],
  properties: {
    branchId: { type: "string" },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    staffId: { type: "string", nullable: true },
    visibility: { type: "string", enum: ["branch", "organization"] },
    urgentCover: { type: "boolean" },
  },
};

spec.components.schemas.ShiftUpdateRequest = {
  type: "object",
  properties: {
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    staffId: { type: "string", nullable: true },
    status: { type: "string", enum: ["open", "scheduled", "cancelled", "completed"] },
    visibility: { type: "string", enum: ["branch", "organization"] },
    urgentCover: { type: "boolean" },
    open: { type: "boolean" },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("swagger rota paths injected");
