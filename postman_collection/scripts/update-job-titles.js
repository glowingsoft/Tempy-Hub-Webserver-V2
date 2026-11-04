const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const find = (items, name) => {
  for (const item of items) {
    if (item.name === name) return item;
    if (item.item) {
      const found = find(item.item, name);
      if (found) return found;
    }
  }
  return null;
};

const staff = find(collection.item, "Staff");
if (!staff) throw new Error("Staff folder not found");

const named = (name) => staff.item.find((i) => i.name === name);
const list = named("list job titles");
const createHead = named("create job title (Head Chef)");
const createHelper = named("create job title (Helper)");
if (!list || !createHead || !createHelper) throw new Error("job title requests not found");

list.request.description =
  "Site manager and line manager: only the titles of their own branch plus the organization-wide ones; a branchId in the query is ignored (before, every branch came back). Owner and super admin see every title and can filter by branchId. Other filters: keyword, departmentId, level, active or status.";

const createNote =
  "A site manager is always saved in their own branch, so do not send branchId. Sending their own is accepted; another branch, null or an empty value returns 403 job_title_outside_managed_branch and nothing is created. Owner and super admin may send branchId; without one the title is organization-wide.";
createHead.request.description = createNote;
createHelper.request.description = createNote;

const updateName = "update job title";
staff.item = staff.item.filter((i) => i.name !== updateName);

const update = {
  name: updateName,
  request: {
    method: "PATCH",
    header: [],
    body: {
      mode: "raw",
      raw: JSON.stringify({ name: "Head Chef", level: "siteManagement", active: true }, null, 2),
      options: { raw: { language: "json" } },
    },
    url: {
      raw: "{{url}}/admin/organizations/{{organizationId}}/job-titles/{{jobTitleId}}",
      host: ["{{url}}"],
      path: ["admin", "organizations", "{{organizationId}}", "job-titles", "{{jobTitleId}}"],
    },
    description:
      "Send only the fields that change: name, level, active, departmentId, branchId. A site manager can edit only titles of their own branch, and cannot send another branch or null as branchId (403 job_title_outside_managed_branch, nothing saved). Owner and super admin can move a title or send branchId null to make it organization-wide.",
  },
  response: [],
};

const at = staff.item.indexOf(list);
staff.item.splice(at + 1, 0, update);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: job titles updated");
