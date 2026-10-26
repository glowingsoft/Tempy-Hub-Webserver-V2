const fs = require("fs");

const FILE = "./swagger/swagger_output.json";
const spec = JSON.parse(fs.readFileSync(FILE, "utf8"));

const kioskToken = {
  name: "x-kiosk-token",
  in: "header",
  required: true,
  schema: { type: "string" },
  description: "Kiosk device JWT from POST /app/kiosk/register",
};
const ok = {
  description: "OK",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiResponse" },
    },
  },
};
const tag = ["Kiosk"];

if (!spec.tags.find((t) => t.name === "Kiosk")) {
  spec.tags.push({
    name: "Kiosk",
    description: "Branch kiosk registration and staff clock-in/out (signInAttendance module).",
  });
}

spec.components.schemas.KioskRegisterRequest = {
  type: "object",
  required: ["branchId", "activationCode", "deviceId", "adminPin"],
  properties: {
    branchId: { type: "string" },
    activationCode: { type: "string", description: "4-digit branch activation code" },
    deviceId: { type: "string" },
    adminPin: { type: "string", description: "4–8 digit PIN for kiosk admin mode" },
    receptionIdentifier: { type: "string" },
    locationLabel: { type: "string" },
  },
};

spec.components.schemas.KioskStaffIdentifyRequest = {
  type: "object",
  description: "nfcTagId, employeeCode + pin, or staffId + pin.",
  properties: {
    nfcTagId: { type: "string" },
    employeeCode: { type: "string" },
    pin: { type: "string" },
    staffId: { type: "string" },
    clientEventId: {
      type: "string",
      description: "Optional. Offline/retry key. Omit on kiosk PIN clock-in/out.",
    },
    occurredAt: { type: "string", format: "date-time" },
    image: {
      type: "string",
      description: "S3 object key only. Server prefixes S3_BASE_URL and saves StaffProfile.photoUrl",
    },
  },
};

spec.components.schemas.KioskScanRequest = {
  type: "object",
  required: ["scanToken"],
  properties: { scanToken: { type: "string" } },
};

spec.components.schemas.KioskOtpRequest = {
  type: "object",
  required: ["staffId"],
  properties: { staffId: { type: "string" } },
};

spec.components.schemas.KioskOtpVerifyRequest = {
  type: "object",
  required: ["staffId", "otp"],
  properties: {
    staffId: { type: "string" },
    otp: { type: "string" },
  },
};

spec.components.schemas.KioskBranchSearchResult = {
  type: "object",
  properties: {
    branchId: { type: "string" },
    branchName: { type: "string" },
    branchCode: { type: "string" },
    organizationId: { type: "string" },
    organizationName: { type: "string" },
    address: {
      type: "object",
      nullable: true,
      properties: {
        line1: { type: "string" },
        line2: { type: "string" },
        city: { type: "string" },
        postcode: { type: "string" },
        county: { type: "string" },
      },
    },
    timezone: { type: "string" },
  },
};

spec.paths["/app/kiosk/branches/search"] = {
  get: {
    tags: tag,
    summary: "Search branches for kiosk setup (public)",
    description:
      "Find active branches in organizations with signInAttendance enabled. Matches organization name, branch name, branch code, or address/postcode.",
    parameters: [
      { name: "keyword", in: "query", required: true, schema: { type: "string", example: "Demo" } },
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
    ],
    responses: {
      200: ok,
      400: { description: "Missing or too-short keyword" },
      429: { description: "Too many requests" },
    },
  },
};

spec.paths["/app/kiosk/register"] = {
  post: {
    tags: tag,
    summary: "Register a kiosk device with a branch activation code",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/KioskRegisterRequest" },
        },
      },
    },
    responses: {
      201: ok,
      400: { description: "Invalid activation code or PIN" },
      403: { description: "Branch inactive or module disabled" },
      409: { description: "Device already registered" },
    },
  },
};

spec.paths["/app/kiosk/me"] = {
  get: {
    tags: tag,
    summary: "Kiosk session and branch context",
    parameters: [kioskToken],
    responses: { 200: ok, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/kiosk/qr"] = {
  get: {
    tags: tag,
    summary: "Rotating QR payload for staff phone scan",
    parameters: [kioskToken],
    responses: { 200: ok },
  },
};

spec.paths["/app/kiosk/scan"] = {
  post: {
    tags: tag,
    summary: "Staff phone scans kiosk QR (user auth)",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "x-org-id", in: "header", required: true, schema: { type: "string" } },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/KioskScanRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Invalid scan token" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/kiosk/pairing/pending"] = {
  get: {
    tags: tag,
    summary: "Poll pending QR pairing session for kiosk confirm screen",
    parameters: [kioskToken],
    responses: { 200: ok },
  },
};

spec.paths["/app/kiosk/pairing/{sessionId}/confirm"] = {
  post: {
    tags: tag,
    summary: "Kiosk confirms Yes it is me after QR scan",
    parameters: [kioskToken, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }],
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              clientEventId: {
      type: "string",
      description: "Optional. Offline/retry key. Omit on kiosk PIN clock-in/out.",
    },
              occurredAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    responses: { 201: ok, 404: { description: "Session not found" } },
  },
};

spec.paths["/app/kiosk/staff/search"] = {
  get: {
    tags: tag,
    summary: "Search branch staff by name (Enter your name flow)",
    parameters: [
      kioskToken,
      { name: "keyword", in: "query", required: true, schema: { type: "string" } },
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
    ],
    responses: { 200: ok },
  },
};

spec.paths["/app/kiosk/staff/{staffId}/preview"] = {
  get: {
    tags: tag,
    summary: "Staff preview before PIN confirm",
    parameters: [
      kioskToken,
      { name: "staffId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: { 200: ok, 404: { description: "Not found" } },
  },
};

spec.paths["/app/kiosk/attendance/otp/request"] = {
  post: {
    tags: tag,
    summary: "Send check-in OTP to staff phone",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/KioskOtpRequest" },
        },
      },
    },
    responses: { 200: ok },
  },
};

spec.paths["/app/kiosk/attendance/otp/verify"] = {
  post: {
    tags: tag,
    summary:
      "Verify check-in OTP only. Returns staff, branch, and organization. Clock in with POST /app/kiosk/attendance/clock-in and staffId within 5 minutes.",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/KioskOtpVerifyRequest" },
        },
      },
    },
    responses: { 200: ok, 400: { description: "Invalid OTP" } },
  },
};

spec.paths["/app/kiosk/attendance/on-site"] = {
  get: {
    tags: tag,
    summary:
      "People currently on site at this kiosk branch (Figma check-out). Optional name/code search + pagination.",
    parameters: [
      kioskToken,
      { name: "keyword", in: "query", schema: { type: "string" } },
      { name: "page", in: "query", schema: { type: "integer" } },
      { name: "limit", in: "query", schema: { type: "integer" } },
    ],
    responses: { 200: ok, 401: { description: "Unauthorized" } },
  },
};

spec.paths["/app/kiosk/attendance/today"] = {
  get: {
    tags: tag,
    summary: "Staff today attendance and active shift (kiosk identify via query)",
    parameters: [
      kioskToken,
      { name: "nfcTagId", in: "query", schema: { type: "string" } },
      { name: "employeeCode", in: "query", schema: { type: "string" } },
      { name: "pin", in: "query", schema: { type: "string" } },
      { name: "staffId", in: "query", schema: { type: "string" } },
    ],
    responses: { 200: ok, 401: { description: "Unauthorized" }, 403: { description: "Forbidden" } },
  },
};

spec.paths["/app/kiosk/attendance/clock-in"] = {
  post: {
    tags: tag,
    summary: "Clock in staff at kiosk (requires active assigned shift)",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/KioskStaffIdentifyRequest" },
        },
      },
    },
    responses: {
      201: ok,
      401: { description: "Staff identification failed" },
      403: { description: "No active shift or wrong branch" },
      409: { description: "Already clocked in" },
    },
  },
};

spec.paths["/app/kiosk/attendance/clock-out"] = {
  post: {
    tags: tag,
    summary: "Clock out staff at kiosk",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/KioskStaffIdentifyRequest" },
        },
      },
    },
    responses: {
      200: ok,
      400: { description: "Not clocked in" },
      401: { description: "Staff identification failed" },
      403: { description: "Wrong branch" },
    },
  },
};

spec.paths["/app/kiosk/visits/categories"] = {
  get: { tags: tag, summary: "Visitor categories for walk-in", parameters: [kioskToken], responses: { 200: ok } },
};
spec.paths["/app/kiosk/visits/people/search"] = {
  get: {
    tags: tag,
    summary: "Search recurring visitors at this kiosk branch",
    parameters: [
      kioskToken,
      { name: "keyword", in: "query", required: true, schema: { type: "string" } },
    ],
    responses: { 200: ok },
  },
};
spec.paths["/app/kiosk/visits/policies"] = {
  get: { tags: tag, summary: "Policies to sign before walk-in/contractor check-in", parameters: [kioskToken], responses: { 200: ok } },
};
spec.paths["/app/kiosk/visits/invite/verify"] = {
  post: {
    tags: tag,
    summary: "Verify visitor invitation code (does not check in)",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object", properties: { inviteCode: { type: "string", description: "6-digit invitation code from email" } } } } },
    },
    responses: { 200: ok, 400: { description: "Invalid or expired code" } },
  },
};
spec.paths["/app/kiosk/visits/invite/resend"] = {
  post: {
    tags: tag,
    summary: "Resend invitation code to visitor email",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } } } } },
    },
    responses: { 200: ok },
  },
};
spec.paths["/app/kiosk/visits/check-in"] = {
  post: {
    tags: tag,
    summary: "Visitor/contractor check-in (invitation, walk-in, or contractor)",
    parameters: [kioskToken],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              method: { type: "string", enum: ["invitation", "walkIn"] },
              inviteCode: { type: "string", description: "6-digit invitation code from email" },
              externalPersonId: { type: "string" },
              type: { type: "string", enum: ["visitor", "contractor", "guest"] },
              name: { type: "string" },
              purposeOfVisit: { type: "string" },
              signatures: { type: "array" },
            },
          },
        },
      },
    },
    responses: { 201: ok, 409: { description: "Already on site" } },
  },
};
spec.paths["/app/kiosk/visits/check-out"] = {
  post: {
    tags: tag,
    summary: "Visitor/contractor check-out",
    parameters: [kioskToken],
    responses: { 200: ok },
  },
};

fs.writeFileSync(FILE, JSON.stringify(spec, null, 2));
console.log("swagger kiosk paths injected");
