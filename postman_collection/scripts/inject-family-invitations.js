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
  { body, query, tests, header, noauth, description } = {}
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
      raw: `{{url}}/${pathParts.join("/")}${query ? `?${query}` : ""}`,
      host: ["{{url}}"],
      path: pathParts,
    },
    ...(description ? { description } : {}),
  },
  response: [],
});

const orgHeader = [
  {
    key: "x-org-id",
    value: "{{organizationId}}",
    description: "Organization scope for admin routes without an organization segment.",
    type: "text",
  },
];

const status = (code, label) => [
  `pm.test("${label}", function () {`,
  `    pm.response.to.have.status(${code});`,
  "});",
];

// ---------------------------------------------------------------- Admin Panel
const adminRequests = [
  req("invite family member", "POST", ["admin", "family-invitations"], {
    header: orgHeader,
    body: {
      email: "{{familyInviteEmail}}",
      name: "Jane Doe",
      residentId: "{{residentId}}",
      relationship: "child",
      isPrimaryContact: false,
    },
    tests: [
      'pm.test("Family invitation created", function () {',
      "    pm.response.to.have.status(201);",
      "});",
      "",
      "// The token only exists in this response (acceptUrl) and in the mailer preview.",
      "const jsonData = pm.response.json();",
      "if (jsonData.data && jsonData.data._id) {",
      '    pm.collectionVariables.set("familyInvitationId", jsonData.data._id);',
      "}",
      "if (jsonData.data && jsonData.data.acceptUrl) {",
      '    pm.collectionVariables.set("familyInviteToken", jsonData.data.acceptUrl.split("/").pop());',
      "}",
    ],
    description:
      "Managers, site managers, line managers and owners (resident handler roles) can invite a relative for a resident. relationship is one of spouse, partner, child, parent, sibling, grandchild, friend, legalGuardian, other. Requires the Residents module.",
  }),
  req("list family invitations", "GET", ["admin", "family-invitations"], {
    header: orgHeader,
    query: "page=1&limit=10&status=pending&residentId={{residentId}}",
    tests: status(200, "Family invitations fetched"),
  }),
  req(
    "get family invitation",
    "GET",
    ["admin", "family-invitations", "{{familyInvitationId}}"],
    { header: orgHeader, tests: status(200, "Family invitation fetched") }
  ),
  req(
    "resend family invitation",
    "POST",
    ["admin", "family-invitations", "{{familyInvitationId}}", "resend"],
    {
      header: orgHeader,
      tests: [
        'pm.test("Family invitation resent", function () {',
        "    pm.response.to.have.status(200);",
        "});",
        "",
        "const jsonData = pm.response.json();",
        "if (jsonData.data && jsonData.data.acceptUrl) {",
        '    pm.collectionVariables.set("familyInviteToken", jsonData.data.acceptUrl.split("/").pop());',
        "}",
      ],
    }
  ),
  req(
    "revoke family invitation",
    "POST",
    ["admin", "family-invitations", "{{familyInvitationId}}", "revoke"],
    { header: orgHeader, tests: status(200, "Family invitation revoked") }
  ),
];

// ------------------------------------------------------------------ App > Auth
const authRequests = [
  req("Login Family", "POST", ["auth", "login"], {
    body: {
      email: "{{familyInviteEmail}}",
      password: "{{password}}",
      deviceType: "android",
      deviceId: "1234",
      timezone: "Europe/London",
      audience: "family",
      surface: "familyApp",
    },
    tests: [
      'pm.test("Status code is 200", function () {',
      "    pm.response.to.have.status(200);",
      "    var jsonData = pm.response.json();",
      "    if (jsonData.data && jsonData.data.token) {",
      '        pm.collectionVariables.set("token", jsonData.data.token);',
      "    }",
      "    pm.test(\"Family access lists linked residents\", function () {",
      "        pm.expect(jsonData.data.access.residents).to.be.an(\"array\");",
      "        pm.expect(jsonData.data.access.defaultSurface).to.eql(\"familyApp\");",
      "    });",
      "});",
    ],
    description:
      "Same login as every other surface with audience=family. Fails with 403 family_profile_not_found when the account has no active family link.",
  }),
  req(
    "preview family invitation",
    "GET",
    ["auth", "family-invitations", "{{familyInviteToken}}"],
    { noauth: true, tests: status(200, "Family invitation preview fetched") }
  ),
  req(
    "accept family invitation",
    "POST",
    ["auth", "family-invitations", "{{familyInviteToken}}", "accept"],
    {
      noauth: true,
      body: { name: "Jane Doe", password: "{{password}}" },
      tests: status(200, "Family invitation accepted"),
      description:
        "Public and token-gated. A new person gets an email-verified account; an existing account keeps its password and only gains the link to the resident. Does not log the person in.",
    }
  ),
];

// ------------------------------------------------------- App > Family Invitations
const myRequests = [
  req("list my family invitations", "GET", ["app", "family-invitations"], {
    query: "page=1&limit=10",
    tests: status(200, "My family invitations fetched"),
  }),
  req(
    "get my family invitation",
    "GET",
    ["app", "family-invitations", "{{familyInvitationId}}"],
    { tests: status(200, "My family invitation fetched") }
  ),
  req(
    "accept my family invitation",
    "POST",
    ["app", "family-invitations", "{{familyInvitationId}}", "accept"],
    {
      tests: status(200, "My family invitation accepted"),
      description:
        "A signed-in user accepts an invitation addressed to their email. No password; used to link an existing account to another resident.",
    }
  ),
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

upsert(ensureFolder(adminFolder, "Family Invitations"), adminRequests);
upsert(ensureFolder(appFolder, "Family Invitations"), myRequests);

const authFolder = appFolder.item.find((i) => i.name === "Auth");
if (!authFolder) throw new Error("App > Auth folder not found");
upsert(authFolder, authRequests);

const vars = collection.variable || [];
for (const [key, value] of [
  ["familyInviteEmail", "family.member@example.com"],
  ["familyInvitationId", ""],
  ["familyInviteToken", ""],
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value, type: "string" });
  }
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman family invitations updated");
