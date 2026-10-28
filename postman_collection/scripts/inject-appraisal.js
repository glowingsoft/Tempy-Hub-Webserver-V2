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

["appraisalId", "appraisalActionPointId"].forEach(upsertVar);

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
      'if (json.data && json.data._id) pm.collectionVariables.set("appraisalId", json.data._id);',
      "const point = json.data && json.data.actionPoints && json.data.actionPoints[0];",
      'if (point && point._id) pm.collectionVariables.set("appraisalActionPointId", point._id);',
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

upsertFolder(adminPanel, "Appraisal", [
  req("PATCH org appraisal interval", "PATCH", orgPath, {
    body: { settings: { defaultAppraisalIntervalMonths: 12 } },
  }),
  req(
    "PATCH staff appraisal settings",
    "PATCH",
    [...orgPath, "staff-profiles", "{{staffProfileId}}", "appraisal-settings"],
    { body: { appraisalIntervalMonths: 12 } }
  ),
  req(
    "PATCH staff compliance settings",
    "PATCH",
    [...orgPath, "staff-profiles", "{{staffProfileId}}", "compliance-settings"],
    { body: { supervisionIntervalMonths: 3, appraisalIntervalMonths: 12 } }
  ),
  req("GET team appraisals", "GET", [...orgPath, "appraisals"], {
    query: "branchId={{branchId}}&staffId={{staffProfileId}}&page=1&limit=10",
  }),
  req("GET compliance history", "GET", [...orgPath, "compliance-history"], {
    query:
      "branchId={{branchId}}&staffId={{staffProfileId}}&type=supervision&page=1&limit=10",
  }),
  req("POST book appraisal", "POST", [...orgPath, "appraisals"], {
    body: {
      staffId: "{{staffProfileId}}",
      kind: "annual",
      status: "scheduled",
      scheduledAt: "2026-11-16T09:00:00",
      periodLabel: "Annual Review 2026",
    },
    test: saveCreated,
  }),
  req("GET appraisal", "GET", [...orgPath, "appraisals", "{{appraisalId}}"]),
  req("PUT complete appraisal", "PUT", [...orgPath, "appraisals", "{{appraisalId}}"], {
    body: {
      status: "completed",
      managerComments: "Meeting held",
      goals: "Complete NVQ",
      trainingNeeds: "Medication refresher",
      actionPoints: ["Book the next review"],
    },
    test: saveCreated,
  }),
  req("POST sign off action points", "POST", [
    ...orgPath,
    "appraisals",
    "{{appraisalId}}",
    "action-points",
    "sign-off",
  ]),
  req("POST sign off one action point", "POST", [
    ...orgPath,
    "appraisals",
    "{{appraisalId}}",
    "action-points",
    "{{appraisalActionPointId}}",
    "sign-off",
  ]),
  req("POST manager sign appraisal", "POST", [
    ...orgPath,
    "appraisals",
    "{{appraisalId}}",
    "manager-sign",
  ]),
]);

upsertFolder(appFolder, "Appraisal", [
  req("GET my appraisal", "GET", ["app", "appraisal"]),
  req("POST acknowledge appraisal", "POST", [
    "app",
    "appraisal",
    "{{appraisalId}}",
    "acknowledge",
  ]),
]);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: Appraisal restored");
