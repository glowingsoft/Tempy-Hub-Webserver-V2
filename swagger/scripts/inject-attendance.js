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
const tag = ["Attendance"];

if (!spec.tags.find((t) => t.name === "Attendance")) {
  spec.tags.push({
    name: "Attendance",
    description: "Clock-in/out, breaks, and attendance change requests (signInAttendance module).",
  });
}

spec.paths["/admin/organizations/{organizationId}/attendance"] = {
  get: {
    tags: tag,
    summary: "List attendance days",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "branchId", in: "query", schema: { type: "string" } },
      { name: "staffId", in: "query", schema: { type: "string" } },
      { name: "presenceStatus", in: "query", schema: { type: "string" } },
      { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
    ],
    responses: { 200: ok, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/organizations/{organizationId}/attendance-change-requests"] = {
  get: {
    tags: tag,
    summary: "List attendance change requests",
    security: bearer,
    parameters: [
      { name: "organizationId", in: "path", required: true, schema: { type: "string" } },
      ...pagination,
      { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "rejected"] } },
    ],
    responses: { 200: ok, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/admin/attendance/{attendanceDayId}"] = {
  get: {
    tags: tag,
    summary: "Get attendance day",
    security: bearer,
    parameters: [
      { name: "attendanceDayId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
  patch: {
    tags: tag,
    summary: "Manually correct attendance day",
    security: bearer,
    parameters: [
      { name: "attendanceDayId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AttendanceUpdateRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Bad request" }, 403: { description: "Forbidden" }, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/attendance-change-requests/{requestId}/approve"] = {
  post: {
    tags: tag,
    summary: "Approve attendance change request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/admin/attendance-change-requests/{requestId}/reject"] = {
  post: {
    tags: tag,
    summary: "Reject attendance change request",
    security: bearer,
    parameters: [
      { name: "requestId", in: "path", required: true, schema: { type: "string" } },
      orgHeader,
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/app/attendance/today"] = {
  get: {
    tags: tag,
    summary: "Today's attendance and active shift eligibility",
    security: bearer,
    parameters: [orgHeader],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/attendance/clock-in"] = {
  post: {
    tags: tag,
    summary: "Clock in (requires active assigned shift)",
    security: bearer,
    parameters: [orgHeader],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AttendanceClockInRequest" },
        },
      },
    },
    responses: { 201: ok, 403: { description: "Forbidden" }, 409: { description: "Already clocked in" } },
  },
};

spec.paths["/app/attendance/clock-out"] = {
  post: {
    tags: tag,
    summary: "Clock out",
    security: bearer,
    parameters: [orgHeader],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AttendanceClockEventRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Bad request" } },
  },
};

spec.paths["/app/attendance/break-in"] = {
  post: {
    tags: tag,
    summary: "Start break",
    security: bearer,
    parameters: [orgHeader],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AttendanceClockEventRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Bad request" } },
  },
};

spec.paths["/app/attendance/break-out"] = {
  post: {
    tags: tag,
    summary: "End break",
    security: bearer,
    parameters: [orgHeader],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AttendanceClockEventRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Bad request" } },
  },
};

spec.paths["/app/attendance"] = {
  get: {
    tags: tag,
    summary: "My attendance history",
    security: bearer,
    parameters: [
      orgHeader,
      ...pagination,
      { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
    ],
    responses: { 200: ok, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/attendance/change-requests"] = {
  post: {
    tags: tag,
    summary: "Request attendance correction",
    security: bearer,
    parameters: [orgHeader],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AttendanceChangeRequestCreate" },
        },
      },
    },
    responses: { 201: ok, 404: { description: "Not found" }, 409: { description: "Pending request exists" } },
  },
};

spec.components.schemas.AttendanceClockInRequest = {
  type: "object",
  properties: {
    checkInMethod: { type: "string", enum: ["phone", "kiosk", "manual", "qr", "nfc"], default: "phone" },
    clientEventId: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
    geo: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        accuracy: { type: "number" },
      },
    },
  },
};

spec.components.schemas.AttendanceClockEventRequest = {
  type: "object",
  properties: {
    clientEventId: { type: "string" },
    occurredAt: { type: "string", format: "date-time" },
  },
};

spec.components.schemas.AttendanceChangeRequestCreate = {
  type: "object",
  required: ["attendanceDayId", "payload"],
  properties: {
    attendanceDayId: { type: "string" },
    payload: { type: "object" },
  },
};

spec.components.schemas.AttendanceUpdateRequest = {
  type: "object",
  properties: {
    clockInAt: { type: "string", format: "date-time" },
    clockOutAt: { type: "string", format: "date-time", nullable: true },
    breaks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          breakInAt: { type: "string", format: "date-time" },
          breakOutAt: { type: "string", format: "date-time", nullable: true },
        },
      },
    },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("swagger attendance paths injected");
