const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");

const upsertVar = (key, value) => {
  if (!collection.variable) collection.variable = [];
  const existing = collection.variable.find((entry) => entry.key === key);
  if (existing) {
    if (value !== undefined && (existing.value === "" || existing.value == null)) {
      existing.value = value;
    }
    return;
  }
  collection.variable.push({ key, value: value ?? "", type: "string" });
};

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveId = (varName, status = 200) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("OK", () => pm.response.to.have.status(${status}));`,
      "const json = pm.response.json();",
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
      "if (json.data && json.data.residentId) pm.collectionVariables.set(\"residentId\", String(json.data.residentId));",
      "if (json.data && json.data.floorPlanId) pm.collectionVariables.set(\"floorPlanId\", String(json.data.floorPlanId));",
    ],
  },
});

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { body, query, test, header, description } = {}) => ({
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
    description: description || "",
  },
  response: [],
});

const peepFolder = {
  name: "PEEP records",
  item: [
    req(
      "peep floor summary",
      "GET",
      ["admin", "organizations", "{{organizationId}}", "peep-floor-summary"],
      { query: "branchId={{branchId}}" }
    ),
    req(
      "list peep records",
      "GET",
      ["admin", "organizations", "{{organizationId}}", "peep-records"],
      { query: "page=1&limit=10&branchId={{branchId}}&peepLevel=&keyword=" }
    ),
    req(
      "create peep record",
      "POST",
      ["admin", "organizations", "{{organizationId}}", "peep-records"],
      {
        body: {
          residentId: "{{residentId}}",
          peepLevel: "high",
          supportNeeds: "Full assistance during evacuation.",
          primaryRoute: "Main stairwell",
          secondaryRoute: "Lift lobby to rear exit",
          equipmentRequired: "Evac chair",
          responsibleStaff: "Night coordinator",
        },
        test: saveId("peepRecordId", 201),
      }
    ),
    req(
      "get peep record by resident",
      "GET",
      [
        "admin",
        "organizations",
        "{{organizationId}}",
        "residents",
        "{{residentId}}",
        "peep-record",
      ],
      { test: saveId("peepRecordId") }
    ),
    req("get peep record", "GET", ["admin", "peep-records", "{{peepRecordId}}"], {
      header: orgHeader,
      test: saveId("peepRecordId"),
    }),
    req("update peep record", "PATCH", ["admin", "peep-records", "{{peepRecordId}}"], {
      header: orgHeader,
      body: {
        peepLevel: "medium",
        supportNeeds: "Partial assistance on stairs.",
      },
      test: saveId("peepRecordId"),
    }),
  ],
};

adminPanel.item = adminPanel.item.filter((folder) => folder.name !== "PEEP records");
adminPanel.item.push(peepFolder);

upsertVar("url", "http://localhost:6060/api/v1/");
upsertVar("token", "");
upsertVar("organizationId", "6ac72d4be20e26c247a731b3");
upsertVar("branchId", "6ac76533e20e26c247a733f5");
upsertVar("residentId", "");
upsertVar("floorPlanId", "");
upsertVar("floorPlanPinId", "");
upsertVar("peepRecordId", "");

const patchLogin = (folder) => {
  for (const item of folder.item || []) {
    if (item.item) patchLogin(item);
    if (item.name !== "Login" || !item.event) continue;
    const test = item.event.find((e) => e.listen === "test");
    const exec = test?.script?.exec;
    if (!exec || exec.some((line) => String(line).includes("peepRecordId"))) continue;
    exec.splice(
      exec.length - 1,
      0,
      '    if (jsonData.data && jsonData.data.access && jsonData.data.access.memberships && jsonData.data.access.memberships.length) {',
      '        var membership = jsonData.data.access.memberships[0];',
      '        if (membership.organizationId) pm.collectionVariables.set("organizationId", String(membership.organizationId));',
      '        if (membership.branchId) pm.collectionVariables.set("branchId", String(membership.branchId));',
      '    }'
    );
  }
};

const appFolder = collection.item.find((i) => i.name === "App");
if (appFolder) patchLogin(appFolder);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("PEEP records folder injected; collection variables upserted");
