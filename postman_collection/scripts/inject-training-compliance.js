const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");

const upsertVar = (key) => {
  if (!collection.variable) collection.variable = [];
  if (collection.variable.some((entry) => entry.key === key)) return;
  collection.variable.push({ key, value: "", type: "string" });
};

["requirementId", "assignmentId"].forEach(upsertVar);

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveRequirementId = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      'if (json.data && json.data._id) pm.collectionVariables.set("requirementId", json.data._id);',
    ],
  },
};

const orgHeader = [
  { key: "x-org-id", value: "{{organizationId}}" },
  { key: "Authorization", value: "Bearer {{token}}" },
];

const req = (name, method, pathParts, { body, query, test } = {}) => ({
  name,
  event: [test || testOk],
  request: {
    method,
    header: orgHeader,
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

const org = ["admin", "organizations", "{{organizationId}}"];

upsertFolder(adminPanel, "Training & Competency", [
  req("GET /admin/organizations/:id/requirements", "GET", [...org, "requirements"], {
    query: "type=competency&keyword=",
  }),
  req("POST /admin/organizations/:id/requirements", "POST", [...org, "requirements"], {
    test: saveRequirementId,
    body: {
      name: "Medication competency",
      type: "competency",
      renewalMonths: 12,
      firstCompletionDays: 30,
      amberDaysOverride: null,
      evidenceRequired: false,
      staffEvidenceAllowed: false,
      appliesTo: { jobTitleIds: [], departmentIds: [] },
    },
  }),
  req("PATCH /admin/requirements/:id", "PATCH", ["admin", "requirements", "{{requirementId}}"], {
    test: saveRequirementId,
    body: { renewalMonths: 12 },
  }),
  req("GET /admin/organizations/:id/assignments", "GET", [...org, "assignments"], {
    query: "type=&staffId=&requirementId=&keyword=&page=1&limit=20",
  }),
  req("POST /admin/organizations/:id/assignments", "POST", [...org, "assignments"], {
    test: {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
          "const json = pm.response.json();",
          "const row = json.data && json.data.assignments && json.data.assignments[0];",
          'if (row && (row.assignmentId || row._id)) pm.collectionVariables.set("assignmentId", row.assignmentId || row._id);',
        ],
      },
    },
    body: {
      requirementId: "{{requirementId}}",
      staffIds: ["{{staffProfileId}}"],
    },
  }),
  req("GET /admin/assignments/:id", "GET", ["admin", "assignments", "{{assignmentId}}"]),
  req("PATCH /admin/assignments/:id", "PATCH", ["admin", "assignments", "{{assignmentId}}"], {
    body: { dueDate: "2026-12-01", renewalMonthsOverride: 12 },
  }),
  req(
    "POST /admin/assignments/:id/records",
    "POST",
    ["admin", "assignments", "{{assignmentId}}", "records"],
    {
      body: {
        completedAt: "2026-10-27",
        notes: "Signed off",
        documents: [
          {
            key: "requirements/example.pdf",
            originalName: "certificate.pdf",
            mimeType: "application/pdf",
            sizeBytes: 12000,
          },
        ],
      },
    }
  ),
  req("DELETE /admin/assignments/:id", "DELETE", ["admin", "assignments", "{{assignmentId}}"]),
  req(
    "GET /admin/organizations/:id/competency-matrix",
    "GET",
    [...org, "competency-matrix"],
    { query: "keyword=&staffId=&jobTitleId=&departmentId=&page=1&limit=20" }
  ),
  req(
    "GET /admin/organizations/:id/training-records",
    "GET",
    [...org, "training-records"],
    { query: "keyword=&status=&page=1&limit=20" }
  ),
]);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("Training & Competency requests injected");
