const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

if (adminPanel.item.some((i) => i.name === "Rota")) {
  console.log("Rota folder already exists — skipping");
  process.exit(0);
}

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveId201 = (varName) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("Created", () => pm.response.to.have.status(201));',
      "const json = pm.response.json();",
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
    ],
  },
});

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

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

adminPanel.item.push({
  name: "Rota",
  item: [
    req("create shift", "POST", ["admin", "organizations", "{{organizationId}}", "shifts"], {
      body: {
        branchId: "{{branchId}}",
        startsAt: "2026-09-02T09:00:00.000Z",
        endsAt: "2026-09-02T17:00:00.000Z",
      },
      test: saveId201("shiftId"),
    }),
    req("list shifts", "GET", ["admin", "organizations", "{{organizationId}}", "shifts"], {
      query: "page=1&limit=10",
    }),
    req("get shift", "GET", ["admin", "shifts", "{{shiftId}}"], { header: orgHeader }),
    req("list shift claims", "GET", ["admin", "organizations", "{{organizationId}}", "shift-claims"], {
      query: "page=1&limit=10&status=pending",
    }),
    req("approve shift claim", "POST", ["admin", "shift-claims", "{{shiftClaimId}}", "approve"], {
      header: orgHeader,
    }),
  ],
});

if (!appFolder.item.some((i) => i.name === "Rota")) {
  appFolder.item.push({
    name: "Rota",
    item: [
      req("my shifts", "GET", ["app", "shifts", "my"], { header: orgHeader }),
      req("open shifts", "GET", ["app", "shifts", "open"], { header: orgHeader }),
      req("active shift", "GET", ["app", "shifts", "active"], { header: orgHeader }),
      req("claim shift", "POST", ["app", "shifts", "{{shiftId}}", "claims"], {
        header: orgHeader,
        body: { note: "Available for cover" },
        test: saveId201("shiftClaimId"),
      }),
      req("withdraw claim", "POST", ["app", "shift-claims", "{{shiftClaimId}}", "withdraw"], {
        header: orgHeader,
      }),
    ],
  });
}

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman rota folder injected");
