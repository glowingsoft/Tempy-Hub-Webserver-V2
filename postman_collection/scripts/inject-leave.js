const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

if (adminPanel.item.some((i) => i.name === "Leave")) {
  console.log("Leave folder already exists — skipping");
  process.exit(0);
}

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveId201 = (varName) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("Created", () => pm.response.to.have.status(201));',
      "const json = pm.response.json();",
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
    ],
  },
});

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { body, query, test, header } = {}) => ({
  name,
  event: [test || testOk],
  request: {
    method,
    header: header || [],
    body: body
      ? {
          mode: "raw",
          raw: JSON.stringify(body, null, 2),
          options: { raw: { language: "json" } },
        }
      : undefined,
    url: {
      raw: `{{url}}${pathParts.join("/")}${query ? `?${query}` : ""}`,
      host: ["{{url}}"],
      path: pathParts,
    },
  },
  response: [],
});

adminPanel.item.push({
  name: "Leave",
  item: [
    req("list leave requests", "GET", ["admin", "organizations", "{{organizationId}}", "leave-requests"], {
      query: "page=1&limit=10&status=pending",
    }),
    req("list leave scores", "GET", ["admin", "organizations", "{{organizationId}}", "leave-scores"], {
      query: "page=1&limit=10",
    }),
    req("record sickness", "POST", ["admin", "organizations", "{{organizationId}}", "leave-requests", "record"], {
      body: {
        staffId: "{{staffProfileId}}",
        leaveType: "sick",
        startDate: "2026-09-15T00:00:00.000Z",
        endDate: "2026-09-15T00:00:00.000Z",
        totalDays: 1,
        reason: "Recorded sickness",
      },
    }),
    req("set entitlement", "PUT", ["admin", "organizations", "{{organizationId}}", "leave-entitlements"], {
      body: {
        staffId: "{{staffProfileId}}",
        year: "2026-2027",
        leaveType: "annual",
        entitlementDays: 28,
      },
    }),
    req("approve leave", "POST", ["admin", "leave-approvals", "{{leaveRequestId}}", "approve"], {
      header: orgHeader,
    }),
  ],
});

if (!appFolder.item.some((i) => i.name === "Leave")) {
  appFolder.item.push({
    name: "Leave",
    item: [
      req("my entitlements", "GET", ["app", "leave-requests", "entitlements"], { header: orgHeader }),
      req("my leave scores", "GET", ["app", "leave-requests", "scores"], { header: orgHeader }),
      req("submit leave", "POST", ["app", "leave-requests"], {
        header: orgHeader,
        body: {
          leaveType: "annual",
          startDate: "2026-09-10T00:00:00.000Z",
          endDate: "2026-09-12T00:00:00.000Z",
          totalDays: 3,
          reason: "Holiday",
        },
        test: saveId201("leaveRequestId"),
      }),
      req("my leave requests", "GET", ["app", "leave-requests"], {
        header: orgHeader,
        query: "page=1&limit=10",
      }),
    ],
  });
}

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman leave folder injected");
