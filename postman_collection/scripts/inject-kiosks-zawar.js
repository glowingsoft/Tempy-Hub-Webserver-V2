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
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
    ],
  },
};

const saveKioskId = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      'if (json.data && json.data._id) pm.collectionVariables.set("kioskId", json.data._id);',
    ],
  },
};

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { query, body, test } = {}) => ({
  name,
  event: [test || testOk],
  request: {
    method,
    header: orgHeader,
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
      ...(query
        ? {
            query: query.split("&").map((pair) => {
              const [key, value] = pair.split("=");
              return { key, value };
            }),
          }
        : {}),
    },
  },
  response: [],
});

const addMissing = (parent, folderName, requests) => {
  let folder = parent.item.find((i) => i.name === folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    parent.item.push(folder);
  }
  for (const request of requests) {
    if (folder.item.some((r) => r.name === request.name)) continue;
    folder.item.push(request);
  }
};

addMissing(adminPanel, "Kiosks", [
  req("list kiosks", "GET", ["admin", "kiosks"], {
    query:
      "page=1&limit=10&branchId={{branchId}}&keyword=&setupStatus=&kioskMode=&presence=",
  }),
  req("create kiosk", "POST", ["admin", "kiosks"], {
    test: saveKioskId,
    body: {
      branchId: "{{branchId}}",
      receptionIdentifier: "Main Entrance",
      locationLabel: "Reception",
      deviceType: "ipad",
    },
  }),
  req("get kiosk", "GET", ["admin", "kiosks", "{{kioskId}}"]),
  req("update kiosk", "PATCH", ["admin", "kiosks", "{{kioskId}}"], {
    body: {
      receptionIdentifier: "Main Entrance",
      locationLabel: "Reception",
      deviceType: "ipad",
      fireEvacuation: true,
    },
  }),
  req("toggle kiosk lock", "POST", ["admin", "kiosks", "{{kioskId}}", "toggle-lock"]),
]);

const vars = collection.variable || [];
if (!vars.find((v) => v.key === "kioskId")) {
  vars.push({ key: "kioskId", value: "", type: "string" });
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("Postman: Admin Panel / Kiosks requests upserted");
