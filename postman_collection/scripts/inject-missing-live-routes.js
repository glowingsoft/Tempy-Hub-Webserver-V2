const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const topFolder = (name) => {
  const folder = collection.item.find((i) => i.name === name);
  if (!folder) throw new Error(`${name} folder not found`);
  return folder;
};

const appFolder = topFolder("App");
const adminFolder = topFolder("Admin Panel");

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
    ],
  },
};

const saveOtp = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OTP generated", function () {',
      "    pm.response.to.have.status(201);",
      "    const jsonData = pm.response.json();",
      "    if (jsonData.data && jsonData.data.otp) {",
      '        pm.collectionVariables.set("otp", jsonData.data.otp);',
      "    }",
      "});",
    ],
  },
};

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { body, header, query, test, noauth, formdata } = {}) => {
  const queryString = query
    ? `?${Object.entries(query)
        .map(([key, value]) => `${key}=${value}`)
        .join("&")}`
    : "";
  const item = {
    name,
    event: [test || testOk],
    request: {
      ...(noauth ? { auth: { type: "noauth" } } : {}),
      method,
      header: header || [],
      url: {
        raw: `{{url}}/${pathParts.join("/")}${queryString}`,
        host: ["{{url}}"],
        path: pathParts,
        ...(query
          ? {
              query: Object.entries(query).map(([key, value]) => ({
                key,
                value: String(value),
              })),
            }
          : {}),
      },
    },
    response: [],
  };
  if (formdata) {
    item.request.body = {
      mode: "formdata",
      formdata,
    };
  } else if (body) {
    item.request.body = {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return item;
};

const ensureFolder = (parent, name) => {
  let folder = parent.item.find((i) => i.name === name);
  if (!folder) {
    folder = { name, item: [] };
    parent.item.push(folder);
  }
  return folder;
};

const upsert = (folder, requests) => {
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

upsert(ensureFolder(appFolder, "Auth"), [
  req(
    "forgot password",
    "POST",
    ["auth", "forgot-password"],
    {
      noauth: true,
      body: { email: "{{email}}" },
      test: saveOtp,
    }
  ),
  req("resend Otp phone", "POST", ["auth", "resend-otp", "phone"], {
    noauth: true,
    body: { phoneNumber: "{{phoneNumber}}" },
    test: saveOtp,
  }),
  req("verify Otp phone", "POST", ["auth", "verify-otp", "phone"], {
    noauth: true,
    body: { phoneNumber: "{{phoneNumber}}", otp: "{{otp}}" },
  }),
]);

upsert(ensureFolder(adminFolder, "Auth"), [
  req(
    "forgot password",
    "POST",
    ["auth", "forgot-password"],
    {
      noauth: true,
      body: { email: "{{adminEmail}}" },
      test: saveOtp,
    }
  ),
  req("resend Otp phone", "POST", ["auth", "resend-otp", "phone"], {
    noauth: true,
    body: { phoneNumber: "{{phoneNumber}}" },
    test: saveOtp,
  }),
  req("verify Otp phone", "POST", ["auth", "verify-otp", "phone"], {
    noauth: true,
    body: { phoneNumber: "{{phoneNumber}}", otp: "{{otp}}" },
  }),
]);

upsert(ensureFolder(appFolder, "Attendance"), [
  req("break in", "POST", ["app", "attendance", "break-in"], {
    header: orgHeader,
  }),
  req("break out", "POST", ["app", "attendance", "break-out"], {
    header: orgHeader,
  }),
  req("create change request", "POST", ["app", "attendance", "change-requests"], {
    header: orgHeader,
    body: {
      attendanceDayId: "{{attendanceDayId}}",
      payload: { note: "Correct clock-in time" },
    },
  }),
  req(
    "request roster for day",
    "POST",
    ["app", "attendance", "{{attendanceDayId}}", "roster-request"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Attendance"), [
  req(
    "update attendance day",
    "PATCH",
    ["admin", "attendance", "{{attendanceDayId}}"],
    {
      header: orgHeader,
      body: { note: "Manager correction" },
    }
  ),
  req(
    "approve change request",
    "POST",
    ["admin", "attendance-change-requests", "{{attendanceChangeRequestId}}", "approve"],
    { header: orgHeader }
  ),
  req(
    "reject change request",
    "POST",
    ["admin", "attendance-change-requests", "{{attendanceChangeRequestId}}", "reject"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Documents"), [
  req("get document", "GET", ["admin", "documents", "{{documentId}}"], {
    header: orgHeader,
  }),
  req("update document", "PATCH", ["admin", "documents", "{{documentId}}"], {
    header: orgHeader,
    body: { title: "Updated document title" },
  }),
  req("delete document", "DELETE", ["admin", "documents", "{{documentId}}"], {
    header: orgHeader,
  }),
  req(
    "list document acknowledgements",
    "GET",
    ["admin", "documents", "{{documentId}}", "acknowledgements"],
    { header: orgHeader }
  ),
  req(
    "add document version",
    "POST",
    ["admin", "documents", "{{documentId}}", "versions"],
    {
      header: orgHeader,
      body: { file: "{{documentFileUrl}}" },
    }
  ),
]);

upsert(ensureFolder(adminFolder, "Departments"), [
  req("get department", "GET", ["admin", "departments", "{{departmentId}}"], {
    header: orgHeader,
  }),
  req("update department", "PATCH", ["admin", "departments", "{{departmentId}}"], {
    header: orgHeader,
    body: { name: "Care Team", active: true },
  }),
]);

upsert(ensureFolder(adminFolder, "Job Titles"), [
  req("get job title", "GET", ["admin", "job-titles", "{{jobTitleId}}"], {
    header: orgHeader,
  }),
  req("update job title", "PATCH", ["admin", "job-titles", "{{jobTitleId}}"], {
    header: orgHeader,
    body: { name: "Senior Carer", active: true },
  }),
]);

upsert(ensureFolder(adminFolder, "Invitations"), [
  req("update invitation", "PATCH", ["admin", "invitations", "{{invitationId}}"], {
    header: orgHeader,
    body: { name: "Updated name", role: "staff" },
  }),
]);

upsert(ensureFolder(adminFolder, "Leave"), [
  req("get leave request", "GET", ["admin", "leave-requests", "{{leaveRequestId}}"], {
    header: orgHeader,
  }),
  req(
    "close leave request",
    "POST",
    ["admin", "leave-requests", "{{leaveRequestId}}", "close"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Rota"), [
  req(
    "reject shift claim",
    "POST",
    ["admin", "shift-claims", "{{shiftClaimId}}", "reject"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Staff"), [
  req(
    "list direct reports",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "staff-profiles", "direct-reports"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Residents"), [
  req(
    "list resident media",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "resident-media"],
    {
      header: orgHeader,
      query: { page: 1, limit: 10, branchId: "{{branchId}}" },
    }
  ),
  req(
    "review resident media",
    "POST",
    [
      "admin",
      "organizations",
      "{{organizationId}}",
      "resident-media",
      "{{residentMediaId}}",
      "review",
    ],
    {
      header: orgHeader,
      body: { decision: "approved", reason: "" },
    }
  ),
]);

upsert(ensureFolder(adminFolder, "Training"), [
  req(
    "get requirement",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "requirements", "{{requirementId}}"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Rota"), [
  req(
    "get shift claim",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "shift-claims", "{{shiftClaimId}}"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Invitations"), [
  req(
    "get org invitation",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "invitations", "{{invitationId}}"],
    { header: orgHeader }
  ),
  req(
    "update org invitation",
    "PATCH",
    ["admin", "organizations", "{{organizationId}}", "invitations", "{{invitationId}}"],
    {
      header: orgHeader,
      body: { name: "Updated name", role: "staff" },
    }
  ),
]);

upsert(ensureFolder(adminFolder, "Departments"), [
  req(
    "get org department",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "departments", "{{departmentId}}"],
    { header: orgHeader }
  ),
  req(
    "update org department",
    "PATCH",
    ["admin", "organizations", "{{organizationId}}", "departments", "{{departmentId}}"],
    {
      header: orgHeader,
      body: { name: "Care Team", active: true },
    }
  ),
]);

upsert(ensureFolder(adminFolder, "Leave"), [
  req(
    "get org leave request",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "leave-requests", "{{leaveRequestId}}"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Visitors & Visit Sessions"), [
  req(
    "deny visit session",
    "POST",
    ["admin", "visit-sessions", "{{visitSessionId}}", "deny"],
    { header: orgHeader }
  ),
  req(
    "toggle visitor user account",
    "PATCH",
    ["admin", "organizations", "{{organizationId}}", "users", "{{userId}}", "account"],
    { header: orgHeader }
  ),
]);

upsert(ensureFolder(adminFolder, "Settings"), [
  req(
    "update admin settings by id",
    "PUT",
    ["admin", "settings", "update", "{{adminSettingsId}}"],
    {
      body: {
        termsAndConditions: "Updated terms",
        aboutUs: "Updated about",
        privacyPolicy: "Updated privacy",
      },
    }
  ),
]);

upsert(ensureFolder(appFolder, "Settings"), [
  req("get faqs", "GET", ["app", "settings", "faqs"], { noauth: true }),
]);

upsert(ensureFolder(appFolder, "Staff"), [
  req("staff dashboard settings", "GET", ["app", "staff", "dashboard-settings"], {
    header: orgHeader,
  }),
]);

upsert(ensureFolder(appFolder, "Users"), [
  req("other user profile", "GET", ["app", "users", "profile", "{{userId}}"], {
    header: orgHeader,
  }),
  req("block user", "POST", ["app", "users", "{{userId}}", "block"], {
    header: orgHeader,
  }),
  req("report user", "POST", ["app", "users", "{{userId}}", "report"], {
    header: orgHeader,
    body: { reason: "spam" },
  }),
  req("add or update subscription", "POST", ["app", "users", "add-update-subscription"], {
    header: orgHeader,
    body: { subscriptionId: "{{subscriptionId}}" },
  }),
  req(
    "remove subscription",
    "POST",
    ["app", "users", "remove-subscription", "{{subscriptionId}}"],
    { header: orgHeader }
  ),
  req("list subscriptions", "GET", ["app", "users", "subscriptions"], {
    header: orgHeader,
  }),
]);

upsert(ensureFolder(appFolder, "Upload"), [
  req("list uploads", "GET", ["upload"]),
  req("upload file", "POST", ["upload"], {
    formdata: [{ key: "file", type: "file", src: [] }],
  }),
  req("get upload by name", "GET", ["upload", "{{filename}}"]),
  req("get upload details", "GET", ["upload", "details", "{{filename}}"]),
]);

const vars = collection.variable || [];
for (const [key, value] of [
  ["phoneNumber", "+441234567890"],
  ["attendanceChangeRequestId", ""],
  ["documentFileUrl", ""],
  ["adminSettingsId", ""],
  ["filename", ""],
  ["subscriptionId", ""],
  ["residentMediaId", ""],
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value, type: "string" });
  }
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("injected missing live routes:", FILE);
