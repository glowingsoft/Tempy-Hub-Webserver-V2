const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const source = fs.readFileSync(FILE, "utf8");
const collection = JSON.parse(source);

const appFolder = collection.item.find((i) => i.name === "App");
if (!appFolder) throw new Error("App folder not found");

const appChild = (name) => {
  const folder = appFolder.item.find((i) => i.name === name);
  if (!folder) throw new Error(`App > ${name} folder not found`);
  return folder;
};

const adminFolder = collection.item.find((i) => i.name === "Admin Panel");
const adminResidents = adminFolder?.item.find((i) => i.name === "Residents");
if (!adminResidents) throw new Error("Admin Panel > Residents folder not found");

const rememberToken = [
  "const jsonData = pm.response.json();",
  "if (jsonData.data && jsonData.data.acceptUrl) {",
  '    pm.collectionVariables.set("residentAccountInviteToken", jsonData.data.acceptUrl.split("/").pop());',
  "}",
];

const ok = [
  'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
];

const req = (
  name,
  method,
  pathParts,
  { body, tests = ok, orgScoped, noauth, description },
) => ({
  name,
  event: [
    { listen: "test", script: { type: "text/javascript", exec: tests } },
  ],
  request: {
    ...(noauth ? { auth: { type: "noauth" } } : {}),
    method,
    header: [
      ...(orgScoped ? [{ key: "x-org-id", value: "{{organizationId}}" }] : []),
      ...(body ? [{ key: "Content-Type", value: "application/json" }] : []),
    ],
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
    description,
  },
  response: [],
});

const staffRequests = [
  req(
    "send resident account invitation",
    "POST",
    ["app", "residents", "{{residentId}}", "account-invitation"],
    {
      orgScoped: true,
      body: { email: "{{residentAccountEmail}}" },
      tests: [...ok, "", ...rememberToken],
      description:
        "Resident screen, profile tab. Sends the invite, or resends it when one is pending (new link, old link stops working). email is optional when a pending invite or the resident record already has one. Returns account { status, email, invitedAt, expiresAt } and acceptUrl. 409: resident_not_admitted, resident_account_already_linked, email_used_by_staff, email_used_by_family_member, email_used_by_another_resident, invitation_already_pending.",
    },
  ),
  req(
    "remove resident account access",
    "DELETE",
    ["app", "residents", "{{residentId}}", "account"],
    {
      orgScoped: true,
      description:
        "Revokes a pending invite and unlinks the resident login. 404 resident_account_not_found when there is neither.",
    },
  ),
];

const authRequests = [
  req(
    "preview resident account invitation",
    "GET",
    ["auth", "visitor-account-invitations", "{{residentAccountInviteToken}}"],
    {
      noauth: true,
      description:
        "Same endpoint as visitor account invitations. For a resident, personType is resident and residentId is included.",
    },
  ),
  req(
    "accept resident account invitation",
    "POST",
    [
      "auth",
      "visitor-account-invitations",
      "{{residentAccountInviteToken}}",
      "accept",
    ],
    {
      noauth: true,
      body: { password: "{{password}}", timezone: "Europe/London" },
      description:
        "Creates the account, or keeps the password when the email already has a non-staff user, and links Resident.userId. Returns userId, email, residentId and personType.",
    },
  ),
  req("Login Resident", "POST", ["auth", "login"], {
    noauth: true,
    body: {
      email: "{{residentAccountEmail}}",
      password: "{{password}}",
      deviceType: "android",
      deviceId: "1234",
      timezone: "Europe/London",
      audience: "resident",
    },
    tests: [
      'pm.test("Resident login", function () {',
      "    pm.response.to.have.status(200);",
      "    var jsonData = pm.response.json();",
      "    if (jsonData.data && jsonData.data.token) {",
      '        pm.collectionVariables.set("token", jsonData.data.token);',
      "    }",
      "});",
    ],
    description:
      "audience=resident is required; without it the account gets a family token. Works only while the resident is admitted and linked. access.resident holds residentId, name, photoUrl, roomNumber, organization and branch.",
  }),
];

const upsert = (folder, requests) => {
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

adminResidents.item = adminResidents.item.filter(
  (r) => r.name !== "create resident with account invitation",
);
const createRequest = adminResidents.item.find(
  (r) => r.name === "create resident",
);
if (!createRequest) throw new Error("create resident request not found");

createRequest.request.body.raw = JSON.stringify(
  {
    name: "James Taylor",
    roomNumber: "106",
    branchId: "{{branchId}}",
    email: "{{residentAccountEmail}}",
    phone: "+447700900001",
    careLevel: "low",
    admissionStatus: "admitted",
    photographyConsent: true,
    visitorPasscode: "1098",
  },
  null,
  2,
);
createRequest.request.description =
  "Creates the resident and always sends the account invitation. email is required and admissionStatus must be admitted. Nothing is created when the invite cannot be sent: 400 for a missing or invalid email, 409 resident_not_admitted, email_used_by_staff, email_used_by_another_resident or invitation_already_pending. The response is the resident plus account { status, email, invitedAt, expiresAt } and acceptUrl. photographyConsent (true or false) records whether photos of the resident may be shared with families; it is what allows photos in family uploads and wall-post tags. Leave it out and it is off. visitorPasscode is optional, 4 to 32 digits.";
const createTest = createRequest.event.find((e) => e.listen === "test");
if (!createTest.script.exec.some((l) => l.includes("residentAccountInviteToken"))) {
  createTest.script.exec.push(
    "if (json.data && json.data.acceptUrl) {",
    '    pm.collectionVariables.set("residentAccountInviteToken", json.data.acceptUrl.split("/").pop());',
    "}",
  );
}
upsert(appChild("Residents & People"), staffRequests);
upsert(appChild("Auth"), authRequests);

const vars = collection.variable || [];
for (const [key, value] of [
  ["residentAccountEmail", "resident.postman@example.com"],
  ["residentAccountInviteToken", ""],
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value, type: "string" });
  }
}
collection.variable = vars;

const output = JSON.stringify(collection, null, 2);
fs.writeFileSync(
  FILE,
  source.includes("\r\n") ? output.replace(/\n/g, "\r\n") : output,
);
console.log("postman resident account requests updated", FILE);
