const fs = require("fs");

const FILE =
  "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
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

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { query } = {}) => ({
  name,
  event: [testOk],
  request: {
    method,
    header: orgHeader,
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

const upsertFolder = (parent, folderName, requests) => {
  let folder = parent.item.find((i) => i.name === folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    parent.item.push(folder);
  }
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

upsertFolder(adminPanel, "Kiosks", [
  req("list kiosks", "GET", ["admin", "kiosks"], {
    query:
      "page=1&limit=10&branchId={{branchId}}&keyword=&setupStatus=&kioskMode=&presence=",
  }),
  req("get kiosk", "GET", ["admin", "kiosks", "{{kioskId}}"]),
]);

const vars = collection.variable || [];
if (!vars.find((v) => v.key === "kioskId")) {
  vars.push({ key: "kioskId", value: "", type: "string" });
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("Zawar postman: Kiosks folder injected under Admin Panel");
