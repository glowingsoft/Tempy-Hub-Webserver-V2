const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const appFolder = collection.item.find((i) => i.name === "App");
if (!appFolder) throw new Error("App folder not found");

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
    ],
  },
};

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

const authHeader = [{ key: "Authorization", value: "Bearer {{token}}" }];

const requests = [
  req("list my invitations", "GET", ["app", "invitations"], {
    header: authHeader,
    query: "page=1&limit=10",
  }),
  req("get my invitation", "GET", ["app", "invitations", "{{invitationId}}"], {
    header: authHeader,
  }),
  req(
    "accept my invitation",
    "POST",
    ["app", "invitations", "{{invitationId}}", "accept"],
    { header: authHeader }
  ),
];

let folder = appFolder.item.find((i) => i.name === "My Invitations");
if (!folder) {
  folder = { name: "My Invitations", item: [] };
  appFolder.item.push(folder);
}

for (const request of requests) {
  const idx = folder.item.findIndex((r) => r.name === request.name);
  if (idx >= 0) folder.item[idx] = request;
  else folder.item.push(request);
}

const vars = collection.variable || [];
if (!vars.find((v) => v.key === "invitationId")) {
  vars.push({ key: "invitationId", value: "", type: "string" });
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman my invitations folder updated");
