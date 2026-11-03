const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

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
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      'if (json.data && json.data._id) pm.collectionVariables.set("supervisionId", json.data._id);',
      "const point = json.data && json.data.actionPoints && json.data.actionPoints[0];",
      'if (point && point._id) pm.collectionVariables.set("actionPointId", point._id);',
    ],
  },
};

const orgHeader = [
  { key: "x-org-id", value: "{{organizationId}}" },
  { key: "Authorization", value: "Bearer {{token}}" },
];

const req = (name, method, pathParts, { body, query, test, header } = {}) => ({
  name,
  event: [test || testOk],
  request: {
    method,
    header: header || orgHeader,
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
              return { key, value: value ?? "" };
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
  folder.item = requests;
  return folder;
};

const orgPath = ["admin", "organizations", "{{organizationId}}"];

upsertFolder(adminPanel, "Supervision", [
  req("PATCH org supervision interval", "PATCH", orgPath, {
    body: { settings: { defaultSupervisionIntervalMonths: 3 } },
  }),
  req(
    "PATCH staff supervision settings",
    "PATCH",
    [...orgPath, "staff-profiles", "{{staffProfileId}}", "supervision-settings"],
    {
      body: {
        supervisorStaffId: "{{supervisorStaffId}}",
        supervisionIntervalMonths: 3,
      },
    }
  ),
  req("GET team supervision", "GET", [...orgPath, "supervision"], {
    query: "branchId={{branchId}}&staffId={{staffProfileId}}&page=1&limit=10",
  }),
  req("POST book supervision", "POST", [...orgPath, "supervision"], {
    body: {
      staffId: "{{staffProfileId}}",
      status: "scheduled",
      scheduledAt: "2026-11-16T09:00:00",
      locationLabel: "Office",
    },
    test: saveCreated,
  }),
  req("GET supervision", "GET", [...orgPath, "supervision", "{{supervisionId}}"]),
  req("PUT complete supervision", "PUT", [...orgPath, "supervision", "{{supervisionId}}"], {
    body: {
      status: "completed",
      topics: ["Wellbeing", "Training"],
      notes: "Meeting held",
      actionPoints: ["Book the next review"],
    },
    test: saveCreated,
  }),
  req("POST sign off action points", "POST", [
    ...orgPath,
    "supervision",
    "{{supervisionId}}",
    "action-points",
    "sign-off",
  ]),
  req("POST sign off one action point", "POST", [
    ...orgPath,
    "supervision",
    "{{supervisionId}}",
    "action-points",
    "{{actionPointId}}",
    "sign-off",
  ]),
]);

upsertFolder(appFolder, "Supervision", [
  req("GET my supervision", "GET", ["app", "supervision"], {
    query: "page=1&limit=10",
  }),
  req("GET my supervision detail", "GET", [
    "app",
    "supervision",
    "{{supervisionId}}",
  ]),
]);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: Supervision restored");
