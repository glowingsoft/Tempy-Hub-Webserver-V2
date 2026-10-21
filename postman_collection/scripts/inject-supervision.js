const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

if (adminPanel.item.some((i) => i.name === "Supervision")) {
  console.log("Supervision folder already exists — skipping");
  process.exit(0);
}

const upsertVar = (key) => {
  if (!collection.variable) collection.variable = [];
  if (collection.variable.some((entry) => entry.key === key)) return;
  collection.variable.push({ key, value: "", type: "string" });
};

["supervisionId", "actionPointId", "supervisorStaffId"].forEach(upsertVar);

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveCreated = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("Created", () => pm.response.to.have.status(201));',
      "const json = pm.response.json();",
      'if (json.data && json.data._id) pm.collectionVariables.set("supervisionId", json.data._id);',
      "const point = json.data && json.data.actionPoints && json.data.actionPoints[0];",
      'if (point && point._id) pm.collectionVariables.set("actionPointId", point._id);',
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
      raw: `{{url}}${pathParts.join("/")}${query ? `?${query}` : ""}`,
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

const orgPath = ["admin", "organizations", "{{organizationId}}"];

adminPanel.item.push({
  name: "Supervision",
  item: [
    req("update org supervision interval", "PATCH", orgPath, {
      body: { settings: { defaultSupervisionIntervalMonths: 3 } },
    }),
    req(
      "update staff supervision settings",
      "PATCH",
      [...orgPath, "staff-profiles", "{{staffProfileId}}", "supervision-settings"],
      {
        body: {
          supervisorStaffId: "{{supervisorStaffId}}",
          supervisionIntervalMonths: 3,
        },
      }
    ),
    req("list team supervision", "GET", [...orgPath, "supervision"], {
      query: "branchId={{branchId}}&staffId={{staffProfileId}}",
    }),
    req("book supervision", "POST", [...orgPath, "supervision"], {
      body: {
        staffId: "{{staffProfileId}}",
        status: "scheduled",
        scheduledAt: "2026-11-16T09:00:00",
        locationLabel: "Office",
      },
      test: saveCreated,
    }),
    req("save completed supervision", "PUT", [...orgPath, "supervision", "{{supervisionId}}"], {
      body: {
        status: "completed",
        topics: ["Wellbeing", "Training"],
        notes: "Meeting held",
        actionPoints: ["Book the next review"],
      },
    }),
    req(
      "sign off action point",
      "POST",
      [
        ...orgPath,
        "supervision",
        "{{supervisionId}}",
        "action-points",
        "{{actionPointId}}",
        "sign-off",
      ]
    ),
  ],
});

if (!appFolder.item.some((i) => i.name === "Supervision")) {
  appFolder.item.push({
    name: "Supervision",
    item: [
      req("my supervision", "GET", ["app", "supervision"], { header: orgHeader }),
    ],
  });
}

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman supervision folder injected");
