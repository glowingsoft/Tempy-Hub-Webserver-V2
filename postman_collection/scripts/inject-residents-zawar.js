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

const saveId = (varName, status = 201) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("Saved", () => pm.expect(pm.response.code).to.be.oneOf([200, ${status}]));`,
      "const json = pm.response.json();",
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
    ],
  },
});

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { body, query, test, header } = {}) => ({
  name,
  event: [test || testOk],
  request: {
    method,
    header: header || orgHeader,
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

upsertFolder(adminPanel, "Residents", [
  req("list residents", "GET", ["admin", "residents"], {
    query: "page=1&limit=10&branchId={{branchId}}&status=&keyword=",
  }),
  req("create resident", "POST", ["admin", "residents"], {
    body: {
      name: "James Taylor",
      roomNumber: "106",
      branchId: "{{branchId}}",
      email: "james.taylor@example.com",
      phone: "+447700900001",
      careLevel: "low",
      admissionStatus: "admitted",
      visitorPasscode: "PASS-1098",
    },
    test: saveId("residentId", 201),
  }),
  req("get resident", "GET", ["admin", "residents", "{{residentId}}"]),
  req("update resident", "PATCH", ["admin", "residents", "{{residentId}}"], {
    body: {
      careLevel: "medium",
      roomNumber: "106",
      admissionStatus: "admitted",
    },
  }),
  req(
    "set visitor passcode",
    "PUT",
    ["admin", "residents", "{{residentId}}", "visitor-passcode"],
    { body: { visitorPasscode: "TAYLOR-9012" } }
  ),
  req(
    "verify visitor passcode",
    "POST",
    ["admin", "residents", "{{residentId}}", "verify-passcode"],
    { body: { visitorPasscode: "TAYLOR-9012" } }
  ),
]);

const vars = collection.variable || [];
if (!vars.find((v) => v.key === "residentId")) {
  vars.push({ key: "residentId", value: "", type: "string" });
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("Zawar postman: Residents folder injected under Admin Panel");
