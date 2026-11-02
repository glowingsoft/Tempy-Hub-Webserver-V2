const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const orgHeader = [
  { key: "x-org-id", value: "{{organizationId}}" },
  { key: "Authorization", value: "Bearer {{token}}" },
];

const req = (name, method, pathParts, { body, query } = {}) => ({
  name,
  event: [testOk],
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
};

const base = ["admin", "organizations", "{{organizationId}}"];

upsertFolder(adminPanel, "Visitor Survey", [
  req("GET visitor survey settings", "GET", [...base, "visitor-survey-settings"]),
  req("PUT visitor survey settings", "PUT", [...base, "visitor-survey-settings"], {
    body: {
      enabled: true,
      notifyVia: { email: true, inApp: true },
      recipients: { siteManager: true, lineManager: false },
      include: {
        ratingSummary: true,
        visitDuration: true,
        whoTheyVisited: true,
        freeText: true,
      },
    },
  }),
  req("GET visitor survey questions", "GET", [...base, "visitor-survey-questions"]),
  req("PUT visitor survey questions", "PUT", [...base, "visitor-survey-questions"], {
    body: {
      questions: [
        {
          key: "expectedVisit",
          prompt: "Was your visit for the reason you expected?",
          type: "yesNo",
          options: ["Yes", "No", "Other"],
          required: true,
          sortOrder: 1,
          active: true,
        },
      ],
    },
  }),
  req("GET visitor survey responses", "GET", [...base, "visitor-survey-responses"], {
    query: "page=1&limit=10&branchId={{branchId}}",
  }),
  req("POST visitor survey response", "POST", [...base, "visitor-survey-responses"], {
    body: {
      branchId: "{{branchId}}",
      visitorName: "Jane Visitor",
      stayDuration: "45 minutes",
      answers: [{ questionId: "{{visitorSurveyQuestionId}}", value: "Yes" }],
    },
  }),
]);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: Visitor Survey restored");
