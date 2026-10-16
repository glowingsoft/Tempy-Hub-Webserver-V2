const fs = require("fs");

const FILE = "./swagger/swagger_output.json";
const spec = JSON.parse(fs.readFileSync(FILE, "utf8"));

const orgId = "{organizationId}";
const bearer = [{ bearerAuth: [] }];
const pagination = [
  { name: "page", in: "query", schema: { type: "integer", default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
];
const orgHeader = {
  name: "x-org-id",
  in: "header",
  required: true,
  schema: { type: "string" },
};

const okList = {
  description: "OK",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiResponse" },
    },
  },
};

const staffTag = ["Staff"];

spec.paths["/admin/organizations/{organizationId}/departments/{departmentId}"] = {
  get: {
    tags: staffTag,
    summary: "Get department",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      { name: "departmentId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: { 200: okList, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
  },
  patch: {
    tags: staffTag,
    summary: "Update department",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      { name: "departmentId", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DepartmentUpdateRequest" },
        },
      },
    },
    responses: { 200: okList, 400: { description: "Bad request" }, 404: { description: "Not found" }, 409: { description: "Duplicate name" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/departments"] = {
  post: {
    tags: staffTag,
    summary: "Create department",
    security: bearer,
    parameters: [{ name: "organizationId", in: "path", required: true, schema: { type: "string" } }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DepartmentCreateRequest" },
        },
      },
    },
    responses: { 201: okList, 400: { description: "Bad request" }, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" }, 409: { description: "Duplicate name" } },
  },
  get: {
    tags: staffTag,
    summary: "List departments",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "keyword", in: "query", schema: { type: "string" } },
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "active", in: "query", schema: { type: "boolean" } },
    ],
    responses: { 200: okList, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/departments/{departmentId}"] = {
  get: {
    tags: staffTag,
    summary: "Get department",
    security: bearer,
    parameters: [
      { name: "departmentId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: okList, 404: { description: "Not found" } },
  },
  patch: {
    tags: staffTag,
    summary: "Update department",
    security: bearer,
    parameters: [
      { name: "departmentId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DepartmentUpdateRequest" },
        },
      },
    },
    responses: { 200: okList, 400: { description: "Bad request" }, 404: { description: "Not found" }, 409: { description: "Duplicate name" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/job-titles/{jobTitleId}"] = {
  patch: {
    tags: staffTag,
    summary: "Update job title",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      { name: "jobTitleId", in: "path", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/JobTitleUpdateRequest" },
        },
      },
    },
    responses: { 200: okList, 400: { description: "Bad request" }, 404: { description: "Not found" }, 409: { description: "Duplicate name" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/job-titles"] = {
  post: {
    tags: staffTag,
    summary: "Create job title",
    security: bearer,
    parameters: [{ name: "organizationId", in: "path", required: true, schema: { type: "string" } }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/JobTitleCreateRequest" },
        },
      },
    },
    responses: { 201: okList, 400: { description: "Bad request" }, 409: { description: "Duplicate name" } },
  },
  get: {
    tags: staffTag,
    summary: "List job titles",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "keyword", in: "query", schema: { type: "string" } },
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "level", in: "query", schema: { type: "string" } },
      { name: "active", in: "query", schema: { type: "boolean" } },
    ],
    responses: { 200: okList },
  },
};

spec.paths["/admin/job-titles/{jobTitleId}"] = {
  get: {
    tags: staffTag,
    summary: "Get job title",
    security: bearer,
    parameters: [
      { name: "jobTitleId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: okList, 404: { description: "Not found" } },
  },
  patch: {
    tags: staffTag,
    summary: "Update job title",
    security: bearer,
    parameters: [
      { name: "jobTitleId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/JobTitleUpdateRequest" },
        },
      },
    },
    responses: { 200: okList, 404: { description: "Not found" }, 409: { description: "Duplicate name" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/staff-profiles"] = {
  post: {
    tags: staffTag,
    summary: "Create staff profile",
    security: bearer,
    parameters: [{ name: "organizationId", in: "path", required: true, schema: { type: "string" } }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/StaffProfileCreateRequest" },
        },
      },
    },
    responses: { 201: okList, 400: { description: "Bad request" }, 409: { description: "Conflict" } },
  },
  get: {
    tags: staffTag,
    summary: "List staff profiles",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "keyword", in: "query", schema: { type: "string" } },
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "departmentId", in: "query", schema: { type: "string" } },
      { name: "jobTitleId", in: "query", schema: { type: "string" } },
      { name: "status", in: "query", schema: { type: "string" } },
    ],
    responses: { 200: okList },
  },
};

spec.paths["/admin/staff-profiles/{staffProfileId}"] = {
  get: {
    tags: staffTag,
    summary: "Get staff profile",
    security: bearer,
    parameters: [
      { name: "staffProfileId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: okList, 404: { description: "Not found" } },
  },
  patch: {
    tags: staffTag,
    summary: "Update staff profile",
    security: bearer,
    parameters: [
      { name: "staffProfileId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/StaffProfileUpdateRequest" },
        },
      },
    },
    responses: { 200: okList, 404: { description: "Not found" } },
  },
};

spec.components.schemas.DepartmentCreateRequest = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", example: "Kitchen" },
    branchId: { type: "string", nullable: true },
    sortOrder: { type: "integer", example: 0 },
  },
};

spec.components.schemas.DepartmentUpdateRequest = {
  type: "object",
  properties: {
    name: { type: "string" },
    branchId: { type: "string", nullable: true },
    sortOrder: { type: "integer" },
    active: { type: "boolean" },
  },
};

spec.components.schemas.JobTitleCreateRequest = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", example: "Head Chef" },
    branchId: { type: "string", nullable: true },
    level: {
      type: "string",
      enum: ["executive", "siteManagement", "operational"],
      example: "operational",
    },
  },
};

spec.components.schemas.JobTitleUpdateRequest = {
  type: "object",
  properties: {
    name: { type: "string" },
    level: { type: "string", enum: ["executive", "siteManagement", "operational"] },
    active: { type: "boolean" },
  },
};

spec.components.schemas.StaffProfileCreateRequest = {
  type: "object",
  required: ["userId", "branchId", "jobTitleId", "startDate"],
  properties: {
    userId: { type: "string" },
    branchId: { type: "string" },
    employeeCode: { type: "string", example: "EMP-K7H2NP" },
    jobTitleId: { type: "string" },
    departmentIds: { type: "array", items: { type: "string" } },
    reportsToStaffId: { type: "string", nullable: true },
    startDate: { type: "string", format: "date-time" },
    phone: { type: "string" },
    pin: { type: "string", example: "1234" },
    status: { type: "string", enum: ["active", "inactive", "onLeave"] },
  },
};

spec.components.schemas.StaffProfileUpdateRequest = {
  type: "object",
  properties: {
    branchId: { type: "string" },
    employeeCode: { type: "string" },
    jobTitleId: { type: "string" },
    departmentIds: { type: "array", items: { type: "string" } },
    reportsToStaffId: { type: "string", nullable: true },
    startDate: { type: "string", format: "date-time" },
    phone: { type: "string" },
    pin: { type: "string" },
    nfcTagId: { type: "string", nullable: true },
    status: { type: "string", enum: ["active", "inactive", "onLeave"] },
  },
};

if (!spec.tags.find((t) => t.name === "Staff")) {
  spec.tags.push({ name: "Staff", description: "Departments, job titles, and staff profiles" });
}

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2) + "\n");
console.log("swagger staff paths added");
