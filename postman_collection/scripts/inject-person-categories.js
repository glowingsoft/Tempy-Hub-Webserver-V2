const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");

if (!collection.variable) collection.variable = [];
if (!collection.variable.some((entry) => entry.key === "personCategoryId")) {
  collection.variable.push({ key: "personCategoryId", value: "", type: "string" });
}

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveId = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      "const row = Array.isArray(json.data) ? json.data[0] : json.data;",
      'if (row && row._id) pm.collectionVariables.set("personCategoryId", row._id);',
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

const orgPath = ["admin", "organizations", "{{organizationId}}", "person-categories"];

upsertFolder(adminPanel, "Person Categories", [
  req("GET person categories", "GET", orgPath, {
    query: "page=1&limit=20&status=&keyword=&appliesTo=",
    test: saveId,
  }),
  req("POST person category", "POST", orgPath, {
    body: { name: "Family / Friend", appliesTo: "visitor" },
    test: saveId,
  }),
  req("PATCH person category", "PATCH", [...orgPath, "{{personCategoryId}}"], {
    body: { name: "Family / Friend", appliesTo: "visitor", active: true },
  }),
  req("DELETE person category", "DELETE", [...orgPath, "{{personCategoryId}}"]),
]);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: Person Categories restored");
