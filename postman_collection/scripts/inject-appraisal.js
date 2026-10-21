const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

if (adminPanel.item.some((i) => i.name === "Appraisal")) {
  console.log("Appraisal folder already exists — skipping");
  process.exit(0);
}

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
      'pm.test("Created", () => pm.response.to.have.status(201));',
      "const json = pm.response.json();",
      'if (json.data && json.data._id) pm.collectionVariables.set("appraisalId", json.data._id);',
      "const point = json.data && json.data.actionPoints && json.data.actionPoints[0];",
      'if (point && point._id) pm.collectionVariables.set("appraisalActionPointId", point._id);',
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
  name: "Appraisal",
  item: [
    req("update org appraisal interval", "PATCH", orgPath, {
      body: { settings: { defaultAppraisalIntervalMonths: 12 } },
    }),
    req(
      "update staff appraisal settings",
      "PATCH",
      [...orgPath, "staff-profiles", "{{staffProfileId}}", "appraisal-settings"],
      { body: { appraisalIntervalMonths: 12 } }
    ),
    req("list team appraisals", "GET", [...orgPath, "appraisals"], {
      query: "branchId={{branchId}}&staffId={{staffProfileId}}",
    }),
    req("org compliance history", "GET", [...orgPath, "compliance-history"], {
      query:
        "branchId={{branchId}}&staffId={{staffProfileId}}&type=supervision&page=1&limit=10",
    }),
    req("book appraisal", "POST", [...orgPath, "appraisals"], {
      body: {
        staffId: "{{staffProfileId}}",
        kind: "annual",
        status: "scheduled",
        scheduledAt: "2026-11-16T09:00:00",
        periodLabel: "Annual Review 2026",
      },
      test: saveCreated,
    }),
    req("save completed appraisal", "PUT", [...orgPath, "appraisals", "{{appraisalId}}"], {
      body: {
        status: "completed",
        managerComments: "Meeting held",
        goals: "Complete NVQ",
        trainingNeeds: "Medication refresher",
        actionPoints: ["Book the next review"],
      },
    }),
    req(
      "sign off appraisal action point",
      "POST",
      [
        ...orgPath,
        "appraisals",
        "{{appraisalId}}",
        "action-points",
        "{{appraisalActionPointId}}",
        "sign-off",
      ]
    ),
    req("manager sign appraisal", "POST", [
      ...orgPath,
      "appraisals",
      "{{appraisalId}}",
      "manager-sign",
    ]),
  ],
});

if (!appFolder.item.some((i) => i.name === "Appraisal")) {
  appFolder.item.push({
    name: "Appraisal",
    item: [
      req("my appraisal", "GET", ["app", "appraisal"], { header: orgHeader }),
      req("acknowledge appraisal", "POST", ["app", "appraisal", "{{appraisalId}}", "acknowledge"], {
        header: orgHeader,
      }),
    ],
  });
}

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman appraisal folder injected");
