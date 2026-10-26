const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
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

const saveDocumentId = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      'if (json.data && json.data._id) pm.collectionVariables.set("documentId", json.data._id);',
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

upsertFolder(adminPanel, "Documents", [
  req(
    "GET /admin/organizations/:id/documents",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "documents"],
    { query: "page=1&limit=10&branchId={{branchId}}&keyword=&category=&audience=visitor" }
  ),
  req(
    "POST /admin/organizations/:id/documents",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "documents"],
    {
      test: saveDocumentId,
      body: {
        title: "Health & Safety Policy",
        category: "healthAndSafety",
        audiences: ["visitor", "staff"],
        branchId: null,
        requiresSignature: true,
        file: {
          key: "documents/health-safety.pdf",
          originalName: "Health-and-Safety.pdf",
          mimeType: "application/pdf",
          sizeBytes: 248391,
        },
      },
    }
  ),
  req("GET /admin/documents/:id", "GET", ["admin", "documents", "{{documentId}}"]),
  req(
    "PATCH /admin/documents/:id",
    "PATCH",
    ["admin", "documents", "{{documentId}}"],
    {
      body: {
        title: "Health & Safety Policy",
        audiences: ["visitor", "staff"],
        requiresSignature: true,
      },
    }
  ),
  req(
    "POST /admin/documents/:id/versions",
    "POST",
    ["admin", "documents", "{{documentId}}", "versions"],
    {
      test: saveDocumentId,
      body: {
        file: {
          key: "documents/health-safety-v2.pdf",
          originalName: "Health-and-Safety-v2.pdf",
          mimeType: "application/pdf",
          sizeBytes: 251000,
        },
      },
    }
  ),
  req(
    "GET /admin/documents/:id/acknowledgements",
    "GET",
    ["admin", "documents", "{{documentId}}", "acknowledgements"],
    { query: "page=1&limit=10" }
  ),
]);

const vars = collection.variable || [];
if (!vars.find((v) => v.key === "documentId")) {
  vars.push({ key: "documentId", value: "", type: "string" });
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman: Admin Panel > Documents");
