const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");

if (adminPanel.item.some((i) => i.name === "Staff")) {
  console.log("Staff folder already exists — skipping");
  process.exit(0);
}

const saveId = (varName) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("OK", () => pm.response.to.have.status(200));`,
      `const json = pm.response.json();`,
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
    ],
  },
});

const saveId201 = (varName) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("Created", () => pm.response.to.have.status(201));`,
      `const json = pm.response.json();`,
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
    ],
  },
});

const req = (name, method, pathParts, { body, query, test, description } = {}) => ({
  name,
  event: test ? [test] : [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test(\"OK\", () => pm.expect(pm.response.code).to.be.oneOf([200,201]));"] } }],
  request: {
    method,
    header: pathParts[0] !== "admin/organizations" && !pathParts.includes("organizations")
      ? [{ key: "x-org-id", value: "{{organizationId}}" }]
      : [],
    body: body
      ? {
          mode: "raw",
          raw: JSON.stringify(body, null, 2),
          options: { raw: { language: "json" } },
        }
      : undefined,
    url: {
      raw: `{{url}}${pathParts.join("/")}${query ? "?" + query : ""}`,
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

adminPanel.item.push({
  name: "Staff",
  description: "Departments, job titles, and staff profiles. See docs/modules/staff.md.",
  item: [
    req("create department", "POST", ["admin", "organizations", "{{organizationId}}", "departments"], {
      body: { name: "Kitchen", sortOrder: 1 },
      test: saveId201("departmentId"),
      description: "Org-wide department. Site managers are pinned to their branch.",
    }),
    req("list departments", "GET", ["admin", "organizations", "{{organizationId}}", "departments"], {
      query: "page=1&limit=10",
    }),
    req("get department", "GET", ["admin", "organizations", "{{organizationId}}", "departments", "{{departmentId}}"], {}),
    req("update department", "PATCH", ["admin", "organizations", "{{organizationId}}", "departments", "{{departmentId}}"], {
      body: { name: "Kitchen", sortOrder: 1, active: true },
    }),
    req("create job title (Head Chef)", "POST", ["admin", "organizations", "{{organizationId}}", "job-titles"], {
      body: { name: "Head Chef", level: "siteManagement" },
      test: saveId201("jobTitleId"),
    }),
    req("create job title (Helper)", "POST", ["admin", "organizations", "{{organizationId}}", "job-titles"], {
      body: { name: "Helper", level: "operational" },
      test: {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            'pm.test("Created", () => pm.response.to.have.status(201));',
            'const json = pm.response.json();',
            'if (json.data && json.data._id) pm.collectionVariables.set("helperJobTitleId", json.data._id);',
          ],
        },
      },
    }),
    req("list job titles", "GET", ["admin", "organizations", "{{organizationId}}", "job-titles"], {
      query: "page=1&limit=10",
    }),
    req("update job title", "PATCH", ["admin", "organizations", "{{organizationId}}", "job-titles", "{{jobTitleId}}"], {
      body: { name: "Head Chef", level: "siteManagement", active: true },
    }),
    req("create staff profile", "POST", ["admin", "organizations", "{{organizationId}}", "staff-profiles"], {
      body: {
        userId: "{{userId}}",
        branchId: "{{branchId}}",
        jobTitleId: "{{jobTitleId}}",
        departmentIds: ["{{departmentId}}"],
        startDate: "2026-01-15T00:00:00.000Z",
        pin: "4321",
      },
      test: saveId201("staffProfileId"),
      description: "User must already have an active membership in this org/branch.",
    }),
    req("list staff profiles", "GET", ["admin", "organizations", "{{organizationId}}", "staff-profiles"], {
      query: "page=1&limit=10",
    }),
    req("get staff profile", "GET", ["admin", "staff-profiles", "{{staffProfileId}}"], {}),
    req("update staff profile", "PATCH", ["admin", "staff-profiles", "{{staffProfileId}}"], {
      body: { ward: "Ward A", locationLabel: "Kitchen prep" },
    }),
  ],
});

const vars = collection.variable;
const addVar = (key, value = "") => {
  if (!vars.find((v) => v.key === key)) vars.push({ key, value, type: "string" });
};
["departmentId", "jobTitleId", "helperJobTitleId", "staffProfileId", "userId"].forEach((k) =>
  addVar(k)
);

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2) + "\n");
console.log("postman Staff folder added");
