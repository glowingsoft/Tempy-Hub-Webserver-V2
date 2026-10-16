const fs = require("fs");

const FILE =
  "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) {
  throw new Error("Admin Panel or App folder not found");
}

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
    ],
  },
};

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
      raw: `{{url}}/${pathParts.join("/")}${query ? `?${query}` : ""}`,
      host: ["{{url}}"],
      path: pathParts,
      ...(query
        ? {
            query: query.split("&").map((pair) => {
              const [key, value] = pair.split("=");
              return { key, value };
            }),
          }
        : {}),
    },
  },
  response: [],
});

const upsertFolder = (parent, folderName, requests) => {
  let folder = parent.item.find((i) => i.name === folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    parent.item.push(folder);
  }
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

upsertFolder(appFolder, "Home", [
  req("home", "GET", ["app", "home"], { header: orgHeader }),
]);

upsertFolder(appFolder, "Leave", [
  req("my entitlements", "GET", ["app", "leave-requests", "entitlements"], {
    header: orgHeader,
  }),
  req("my leave scores", "GET", ["app", "leave-requests", "scores"], {
    header: orgHeader,
    query: "from=&to=",
  }),
  req("submit leave", "POST", ["app", "leave-requests"], {
    header: orgHeader,
    body: {
      leaveType: "annual",
      startDate: "2026-09-10T00:00:00.000Z",
      endDate: "2026-09-12T00:00:00.000Z",
      totalDays: 3,
      reason: "Holiday",
    },
    test: {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          'pm.test("Created", () => pm.response.to.have.status(201));',
          "const json = pm.response.json();",
          'if (json.data && json.data._id) pm.collectionVariables.set("leaveRequestId", json.data._id);',
        ],
      },
    },
  }),
  req("my leave requests", "GET", ["app", "leave-requests"], {
    header: orgHeader,
    query: "page=1&limit=10",
  }),
  req("get leave request", "GET", ["app", "leave-requests", "{{leaveRequestId}}"], {
    header: orgHeader,
  }),
  req("cancel leave", "POST", ["app", "leave-requests", "{{leaveRequestId}}", "cancel"], {
    header: orgHeader,
  }),
]);

upsertFolder(adminPanel, "Leave", [
  req(
    "list leave requests",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "leave-requests"],
    { query: "page=1&limit=10&status=pending" }
  ),
  req(
    "list leave scores",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "leave-scores"],
    { query: "page=1&limit=10" }
  ),
  req(
    "record sickness",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "leave-requests", "record"],
    {
      body: {
        staffId: "{{staffProfileId}}",
        leaveType: "sick",
        startDate: "2026-09-15T00:00:00.000Z",
        endDate: "2026-09-15T00:00:00.000Z",
        totalDays: 1,
        reason: "Recorded sickness",
      },
    }
  ),
  req(
    "set entitlement",
    "PUT",
    ["admin", "organizations", "{{organizationId}}", "leave-entitlements"],
    {
      body: {
        staffId: "{{staffProfileId}}",
        year: "2026-2027",
        leaveType: "annual",
        entitlementDays: 28,
      },
    }
  ),
  req("approve leave", "POST", ["admin", "leave-approvals", "{{leaveRequestId}}", "approve"], {
    header: orgHeader,
  }),
  req("reject leave", "POST", ["admin", "leave-approvals", "{{leaveRequestId}}", "reject"], {
    header: orgHeader,
    body: { reason: "Not enough cover" },
  }),
]);

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("Zawar collection: leave scores + home org header injected");
