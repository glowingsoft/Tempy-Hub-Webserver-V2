const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const topFolder = (name) => {
  const folder = collection.item.find((i) => i.name === name);
  if (!folder) throw new Error(`${name} folder not found`);
  return folder;
};
const appFolder = topFolder("App");
const adminFolder = topFolder("Admin Panel");

const test = (lines) => ({
  listen: "test",
  script: { type: "text/javascript", exec: lines },
});

const req = (
  name,
  method,
  pathParts,
  { body, tests, header, noauth, description } = {}
) => ({
  name,
  event: tests ? [test(tests)] : [],
  request: {
    ...(noauth ? { auth: { type: "noauth" } } : {}),
    method,
    header: header || [],
    ...(body
      ? {
          body: {
            mode: "raw",
            raw: JSON.stringify(body, null, 2),
            options: { raw: { language: "json" } },
          },
        }
      : {}),
    url: {
      raw: `{{url}}/${pathParts.join("/")}`,
      host: ["{{url}}"],
      path: pathParts,
    },
    ...(description ? { description } : {}),
  },
  response: [],
});

const adminRequests = [
  req(
    "invite visitor account",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "visitor-account-invitations"],
    {
      body: {
        branchId: "{{branchId}}",
        email: "{{visitorAccountEmail}}",
        name: "John Doe",
        type: "contractor",
      },
      tests: [
        'pm.test("Visitor account invitation created", function () {',
        "    pm.response.to.have.status(201);",
        "});",
        "",
        "const jsonData = pm.response.json();",
        "if (jsonData.data && jsonData.data.acceptUrl) {",
        '    pm.collectionVariables.set("visitorAccountInviteToken", jsonData.data.acceptUrl.split("/").pop());',
        "}",
      ],
      description:
        "Sends an app-login invite for a visitor or contractor. type is visitor or contractor. If an external person with this email already exists at the branch and has no login, accept links that row. This is not the 6-digit visit code.",
    }
  ),
];

const authRequests = [
  req(
    "preview visitor account invitation",
    "GET",
    ["auth", "visitor-account-invitations", "{{visitorAccountInviteToken}}"],
    {
      noauth: true,
      tests: [
        'pm.test("Visitor account invitation preview", function () {',
        "    pm.response.to.have.status(200);",
        "});",
      ],
    }
  ),
  req(
    "accept visitor account invitation",
    "POST",
    ["auth", "visitor-account-invitations", "{{visitorAccountInviteToken}}", "accept"],
    {
      noauth: true,
      body: {
        name: "John Doe",
        password: "{{password}}",
        timezone: "Europe/London",
      },
      tests: [
        'pm.test("Visitor account invitation accepted", function () {',
        "    pm.response.to.have.status(200);",
        "});",
      ],
      description:
        "Sets the password for a new account, or keeps the password when the email already has a non-staff user. Links ExternalPerson.userId at the invited branch.",
    }
  ),
  req("Login Visitor", "POST", ["auth", "login"], {
    noauth: true,
    body: {
      email: "{{visitorAccountEmail}}",
      password: "{{password}}",
      deviceType: "android",
      deviceId: "1234",
      timezone: "Europe/London",
      audience: "visitor",
    },
    tests: [
      'pm.test("Visitor login", function () {',
      "    pm.response.to.have.status(200);",
      "    var jsonData = pm.response.json();",
      "    if (jsonData.data && jsonData.data.token) {",
      '        pm.collectionVariables.set("token", jsonData.data.token);',
      "    }",
      "});",
    ],
    description:
      "Same login as other surfaces with audience=visitor. Requires ExternalPerson.userId, which accept sets.",
  }),
];

const upsert = (folder, requests) => {
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

const ensureFolder = (parent, name) => {
  let folder = parent.item.find((i) => i.name === name);
  if (!folder) {
    folder = { name, item: [] };
    parent.item.push(folder);
  }
  return folder;
};

upsert(ensureFolder(adminFolder, "Visitor Account Invitations"), adminRequests);

const authFolder = appFolder.item.find((i) => i.name === "Auth");
if (!authFolder) throw new Error("App > Auth folder not found");
upsert(authFolder, authRequests);

const vars = collection.variable || [];
for (const [key, value] of [
  ["visitorAccountEmail", "contractor.postman@example.com"],
  ["visitorAccountInviteToken", ""],
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value, type: "string" });
  }
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman visitor account invitations updated", FILE);
