const fs = require("fs");

const FILE = "./postman_collection/TempyHubAPI.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

if (adminPanel.item.some((i) => i.name === "Attendance")) {
  console.log("Attendance folder already exists — skipping");
  process.exit(0);
}

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

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

adminPanel.item.push({
  name: "Attendance",
  item: [
    req("list attendance", "GET", ["admin", "organizations", "{{organizationId}}", "attendance"], {
      query: "page=1&limit=10",
    }),
    req("get attendance day", "GET", ["admin", "attendance", "{{attendanceDayId}}"], {
      header: orgHeader,
    }),
    req("list change requests", "GET", ["admin", "organizations", "{{organizationId}}", "attendance-change-requests"], {
      query: "page=1&limit=10&status=pending",
    }),
  ],
});

if (!appFolder.item.some((i) => i.name === "Attendance")) {
  appFolder.item.push({
    name: "Attendance",
    item: [
      req("today", "GET", ["app", "attendance", "today"], { header: orgHeader }),
      req("clock in", "POST", ["app", "attendance", "clock-in"], {
        header: orgHeader,
        body: { checkInMethod: "phone", clientEventId: "postman-clock-in-1" },
      }),
      req("clock out", "POST", ["app", "attendance", "clock-out"], { header: orgHeader }),
      req("my attendance", "GET", ["app", "attendance"], {
        header: orgHeader,
        query: "page=1&limit=10",
      }),
    ],
  });
}

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman attendance folder injected");
