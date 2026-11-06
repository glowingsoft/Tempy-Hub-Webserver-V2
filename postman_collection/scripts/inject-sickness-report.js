const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const findParent = (items, name) => {
  for (const item of items) {
    if (!item.item) continue;
    if (item.item.some((child) => child.name === name)) return item;
    const found = findParent(item.item, name);
    if (found) return found;
  }
  return null;
};

const anchorName = "late check-ins report";
const parent = findParent(collection.item, anchorName);
if (!parent) throw new Error("late check-ins report not found");

const name = "sickness rate report";
parent.item = parent.item.filter((i) => i.name !== name);

const query = [
  { key: "branchId", value: "{{branchId}}" },
  { key: "departmentId", value: "", disabled: true },
  { key: "from", value: "2026-09-01" },
  { key: "to", value: "2026-09-30" },
  { key: "keyword", value: "", disabled: true },
  { key: "page", value: "1" },
  { key: "limit", value: "20" },
  { key: "format", value: "csv", disabled: true },
];

const request = {
  name,
  event: [
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
        ],
      },
    },
  ],
  request: {
    method: "GET",
    header: [],
    url: {
      raw:
        "{{url}}/admin/organizations/{{organizationId}}/reports/sickness-rate?branchId={{branchId}}&from=2026-09-01&to=2026-09-30&page=1&limit=20",
      host: ["{{url}}"],
      path: ["admin", "organizations", "{{organizationId}}", "reports", "sickness-rate"],
      query,
    },
    description:
      "Sickness rate screen. Returns kpis (sicknessRate, staffAffected, totalSickDays) and one row per employee with sickDays, the main leaveType and leaveTypeLabel (SSP, SMP, Unpaid...), and days[] with the date and reason of each day. Filters: branchId (all sites by default), departmentId, from and to (current month by default), keyword (name or email). Add format=csv for the Export CSV button.",
  },
  response: [],
};

const at = parent.item.findIndex((i) => i.name === anchorName);
parent.item.splice(at + 1, 0, request);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: sickness rate report added");
