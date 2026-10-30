const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const topFolder = (name) => {
  const folder = collection.item.find((i) => i.name === name);
  if (!folder) throw new Error(`${name} folder not found`);
  return folder;
};

const adminFolder = topFolder("Admin Panel");
const appFolder = topFolder("App");

const test = (lines) => ({
  listen: "test",
  script: { type: "text/javascript", exec: lines },
});

const req = (name, method, pathParts, { body, tests, description } = {}) => ({
  name,
  event: tests ? [test(tests)] : [],
  request: {
    method,
    header: [{ key: "x-org-id", value: "{{organizationId}}" }],
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

const orgPath = [
  "admin",
  "organizations",
  "{{organizationId}}",
  "staff-dashboard-settings",
];

const adminRequests = [
  req("get staff dashboard settings", "GET", orgPath, {
    tests: [
      'pm.test("Staff dashboard settings loaded", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description:
      "Owner/super-admin. Returns cards.checkIn / cards.pendingLeave plus catalog for the Staff Dashboard Settings screen.",
  }),
  req("save staff dashboard settings", "PUT", orgPath, {
    body: { cards: { checkIn: true, pendingLeave: false } },
    tests: [
      'pm.test("Staff dashboard settings saved", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description:
      "Owner/super-admin. Toggles which staff-home cards are shown. Not kiosk widgets.",
  }),
  req("reset staff dashboard settings", "POST", [...orgPath, "reset"], {
    tests: [
      'pm.test("Staff dashboard settings reset", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description: "Sets checkIn and pendingLeave back to false.",
  }),
];

const appRequests = [
  req(
    "get my staff dashboard settings",
    "GET",
    ["staff", "dashboard-settings"],
    {
      tests: [
        'pm.test("Staff dashboard settings for app", function () {',
        "    pm.response.to.have.status(200);",
        "});",
      ],
      description:
        "Staff app. Effective visibility after org toggles, attendance/leave modules, and site allowPhoneCheckIn / enableLeaveRequests.",
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

upsert(ensureFolder(adminFolder, "Staff Dashboard Settings"), adminRequests);
upsert(ensureFolder(appFolder, "Staff Dashboard Settings"), appRequests);

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman staff dashboard settings updated", FILE);
