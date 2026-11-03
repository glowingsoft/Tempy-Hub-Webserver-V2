const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { body, query, header } = {}) => ({
  name,
  event: [testOk],
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

const attendanceAdmin = adminPanel.item.find((i) => i.name === "Attendance");
if (attendanceAdmin && !attendanceAdmin.item.some((i) => i.name === "approve roster")) {
  attendanceAdmin.item.push(
    req(
      "list unscheduled attendance",
      "GET",
      ["admin", "organizations", "{{organizationId}}", "attendance"],
      { query: "page=1&limit=10&punctualityStatus=unscheduled" }
    ),
    req(
      "approve roster",
      "POST",
      [
        "admin",
        "organizations",
        "{{organizationId}}",
        "attendance",
        "{{attendanceDayId}}",
        "approve-roster",
      ],
      { body: {} }
    ),
    req(
      "reject roster",
      "POST",
      [
        "admin",
        "organizations",
        "{{organizationId}}",
        "attendance",
        "{{attendanceDayId}}",
        "reject-roster",
      ],
      { body: {} }
    )
  );
}

const attendanceApp = appFolder.item.find((i) => i.name === "Attendance");
if (attendanceApp && !attendanceApp.item.some((i) => i.name === "roster request")) {
  attendanceApp.item.push(
    req(
      "roster request",
      "POST",
      ["app", "attendance", "{{attendanceDayId}}", "roster-request"],
      { header: orgHeader }
    )
  );
}

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("unscheduled roster routes injected");
