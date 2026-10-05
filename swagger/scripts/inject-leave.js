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
const tag = ["Leave"];

if (!spec.tags.find((t) => t.name === "Leave")) {
  spec.tags.push({
    name: "Leave",
    description: "Leave requests, entitlements, and approvals (leave module).",
  });
}

spec.paths["/admin/organizations/{organizationId}/leave-requests"] = {
  get: {
    tags: tag,
    summary: "List leave requests",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "staffId", in: "query", schema: { type: "string" } },
      { name: "status", in: "query", schema: { type: "string" } },
      { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
    ],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/leave-requests/record"] = {
  post: {
    tags: tag,
    summary: "Record manager sickness or other leave",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/LeaveRecordRequest" },
        },
      },
    },
    responses: { 201: ok, 400: { description: "Bad request" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/leave-entitlements"] = {
  get: {
    tags: tag,
    summary: "List leave entitlements",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "staffId", in: "query", schema: { type: "string" } },
      { name: "year", in: "query", schema: { type: "string" } },
    ],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
  put: {
    tags: tag,
    summary: "Set leave entitlement for a staff member",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/LeaveEntitlementUpsert" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Bad request" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/leave-requests/{requestId}"] = {
  get: {
    tags: tag,
    summary: "Get leave request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/leave-requests/{requestId}/close"] = {
  post: {
    tags: tag,
    summary: "Close approved leave (mark as taken)",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/leave-approvals/{requestId}/approve"] = {
  post: {
    tags: tag,
    summary: "Approve leave request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/leave-approvals/{requestId}/reject"] = {
  post: {
    tags: tag,
    summary: "Reject leave request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/app/leave-requests/entitlements"] = {
  get: {
    tags: tag,
    summary: "My leave balances",
    security: bearer,
    parameters: [
      orgHeader,
      { name: "year", in: "query", schema: { type: "string" } },
    ],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/leave-requests"] = {
  get: {
    tags: tag,
    summary: "My leave requests",
    security: bearer,
    parameters: [orgHeader, ...pagination, { name: "status", in: "query", schema: { type: "string" } }],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
  post: {
    tags: tag,
    summary: "Submit leave request",
    security: bearer,
    parameters: [orgHeader],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/LeaveRequestCreate" },
        },
      },
    },
    responses: { 201: ok, 400: { description: "Bad request" }, 409: { description: "Overlap" } },
  },
};

spec.paths["/app/leave-requests/{requestId}"] = {
  get: {
    tags: tag,
    summary: "Get my leave request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/app/leave-requests/{requestId}/cancel"] = {
  post: {
    tags: tag,
    summary: "Cancel my leave request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.components.schemas.LeaveRequestCreate = {
  type: "object",
  required: ["startDate", "endDate", "totalDays"],
  properties: {
    leaveType: { type: "string", enum: ["annual", "sick", "unpaid", "compassionate", "parental", "other"] },
    startDate: { type: "string", format: "date-time" },
    endDate: { type: "string", format: "date-time" },
    totalDays: { type: "number", minimum: 0.5 },
    reason: { type: "string" },
    attachmentUrl: { type: "string" },
  },
};

spec.components.schemas.LeaveRecordRequest = {
  type: "object",
  required: ["staffId", "startDate", "endDate", "totalDays"],
  properties: {
    staffId: { type: "string" },
    leaveType: { type: "string", enum: ["annual", "sick", "unpaid", "compassionate", "parental", "other"] },
    startDate: { type: "string", format: "date-time" },
    endDate: { type: "string", format: "date-time" },
    totalDays: { type: "number", minimum: 0.5 },
    reason: { type: "string" },
  },
};

spec.components.schemas.LeaveEntitlementUpsert = {
  type: "object",
  required: ["staffId", "year", "entitlementDays"],
  properties: {
    staffId: { type: "string" },
    year: { type: "string", example: "2026-2027" },
    leaveType: { type: "string", enum: ["annual", "sick", "unpaid", "compassionate", "parental", "other"] },
    entitlementDays: { type: "number", minimum: 0 },
    carriedOverDays: { type: "number", minimum: 0 },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("swagger leave paths injected");
