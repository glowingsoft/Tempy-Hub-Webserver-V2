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
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const req = (name, method, pathParts, query) => ({
  name,
  event: [testOk],
  request: {
    method,
    header: [],
    url: {
      raw: `{{url}}/${pathParts.join("/")}${query ? `?${query}` : ""}`,
      host: ["{{url}}"],
      path: pathParts,
      ...(query
        ? {
            query: query.split("&").map((pair) => {
              const [key, value] = pair.split("=");
              return { key, value: value ?? "" };
            }),
          }
        : {}),
    },
  },
  response: [],
});

const ensureFolder = (parent, folderName) => {
  let folder = parent.item.find((i) => i.name === folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    parent.item.push(folder);
  }
  return folder;
};

const upsertRequest = (folder, request) => {
  const index = folder.item.findIndex((i) => i.name === request.name);
  if (index === -1) folder.item.push(request);
  else folder.item[index] = request;
};

const org = ["admin", "organizations", "{{organizationId}}"];
const reportQuery = "branchId={{branchId}}&page=1&limit=20";

const rota = ensureFolder(adminPanel, "Rota");
upsertRequest(
  rota,
  req("get rota board", "GET", [...org, "rota", "board"], "branchId={{branchId}}&period=week&scope=all")
);

const attendance = ensureFolder(adminPanel, "Attendance");
upsertRequest(
  attendance,
  req("get attendance rota", "GET", [...org, "attendance", "rota"], "branchId={{branchId}}")
);

const reports = ensureFolder(adminPanel, "Reports");
upsertRequest(reports, req("attendance report", "GET", [...org, "reports", "attendance"], reportQuery));
upsertRequest(
  reports,
  req("visitor check-ins report", "GET", [...org, "reports", "visitor-check-ins"], reportQuery)
);
upsertRequest(
  reports,
  req("staff hours summary", "GET", [...org, "reports", "staff-hours-summary"], reportQuery)
);
upsertRequest(
  reports,
  req("late check-ins report", "GET", [...org, "reports", "late-check-ins"], reportQuery)
);

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman rota board + reports injected");
