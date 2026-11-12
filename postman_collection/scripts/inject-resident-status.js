const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const app = collection.item.find((item) => item.name === "App");
if (!app) throw new Error("App folder not found");
const admin = collection.item.find((item) => item.name === "Admin Panel");
if (!admin) throw new Error("Admin Panel folder not found");
const adminResidents = admin.item.find((item) => item.name === "Residents");
if (!adminResidents) throw new Error("Admin Panel > Residents folder not found");

const FOLDER = "Residents & People";

const make = ({ name, method, base, path, query = [], body, description }) => {
  const raw = `{{url}}/${base}/${path}`;
  const enabled = query.filter((q) => !q.disabled);
  return {
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
      method,
      header: [
        { key: "x-org-id", value: "{{organizationId}}" },
        ...(body ? [{ key: "Content-Type", value: "application/json" }] : []),
      ],
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
        raw: enabled.length
          ? `${raw}?${enabled.map((q) => `${q.key}=${q.value}`).join("&")}`
          : raw,
        host: ["{{url}}"],
        path: [base, ...path.split("/")],
        ...(query.length ? { query } : {}),
      },
      description,
    },
    response: [],
  };
};

const appRequests = [
  make({
    name: "list residents (tabs all, restricted, out)",
    method: "GET",
    base: "app",
    path: "residents",
    query: [
      { key: "tab", value: "all", description: "all, restricted or out" },
      { key: "keyword", value: "", disabled: true },
      { key: "branchId", value: "{{branchId}}", disabled: true },
      { key: "page", value: "1" },
      { key: "limit", value: "20" },
    ],
    description:
      "Residents screen of the manager app. Query: tab (all, restricted, out), admissionStatus (admitted by default, or discharged), keyword (name or room), branchId (owner and super admin only), page, limit. meta.tabCounts has the counts of the three tabs. Row: name, roomNumber, photoUrl, careLevel, admissionStatus, peep {recorded, level, mobility, equipment, assistance}, restriction {active, reason, since}, out {active, destination, note, since, expectedReturnAt} and, once deactivated, discharge.",
  }),
  make({
    name: "get resident (status)",
    method: "GET",
    base: "app",
    path: "residents/{{residentId}}",
    description:
      "One resident, opened from the Residents list: restriction, out, peep summary and discharge details.",
  }),
  make({
    name: "deactivate resident (reason and message)",
    method: "POST",
    base: "app",
    path: "residents/{{residentId}}/deactivate",
    body: {
      reason: "movedOut",
      message: "We wish them every happiness in their new home.",
    },
    description:
      "reason: movedOut, passedAway, movedToAnotherTempyHome or other. message is optional; it goes to every active family member as a notification only when given (no automatic message). Sets the resident to discharged, cancels upcoming family visits and open visit passes, and records the 30 day family access end date. 409 resident_not_admitted when already discharged.",
  }),
  make({
    name: "list people (tabs)",
    method: "GET",
    base: "app",
    path: "site-live/people",
    query: [
      {
        key: "tab",
        value: "staff",
        description:
          "staff, residents, visitors, contractors, residentsOut or didNotSignOut",
      },
      { key: "days", value: "7", description: "didNotSignOut look-back, 1 to 31" },
      { key: "branchId", value: "{{branchId}}", disabled: true },
      { key: "page", value: "1" },
      { key: "limit", value: "20" },
    ],
    description:
      "People screen of the manager app. tab: staff, residents, visitors (visitor and guest), contractors (contractor and professional), residentsOut or didNotSignOut. meta.tabCounts has the count of every tab. didNotSignOut lists sign-ins from earlier days that are still open or were closed by auto-checkout (status stillSignedIn or autoSignedOut).",
  }),
  make({
    name: "check out person",
    method: "POST",
    base: "app",
    path: "site-live/people/{{personKind}}/{{recordId}}/check-out",
    body: {},
    description:
      "Check Out button of the People screen. personKind: staff, visitor, contractor, professional or guest. recordId: the _id of the row. Optional body checkOutAt (after the sign-in, not in the future). For a missed sign-out the row leaves the Didn't Sign Out tab and a reminder is shown once at the person's next kiosk sign-in (signOutReminder).",
  }),
];

const adminRequests = [
  make({
    name: "set resident restricted",
    method: "PUT",
    base: "admin",
    path: "residents/{{residentId}}/restriction",
    body: { restricted: true, reason: "No visits from the named person" },
    description:
      "Mark a resident restricted (restricted true, optional reason) or clear it (restricted false). Admitted residents only. The app shows the Restricted badge and tab.",
  }),
  make({
    name: "set resident out of home",
    method: "PUT",
    base: "admin",
    path: "residents/{{residentId}}/out",
    body: {
      out: true,
      destination: "Hospital appointment",
      note: "Taken by family",
      expectedReturnAt: "2026-11-20T16:00:00.000Z",
    },
    description:
      "Mark a resident out of the home (out true; destination, note and expectedReturnAt optional) or back in (out false). Admitted residents only. The app shows the Out tab.",
  }),
];

let folder = app.item.find((item) => item.name === FOLDER);
if (!folder) {
  folder = { name: FOLDER, item: [] };
  const at = app.item.findIndex((item) => item.name === "Evacuation");
  app.item.splice(at + 1, 0, folder);
}
folder.item = appRequests;

const adminNames = new Set(adminRequests.map((r) => r.name));
const at = adminResidents.item.findIndex(
  (item) => item.name === "update resident",
);
adminResidents.item = adminResidents.item.filter(
  (item) => !adminNames.has(item.name),
);
adminResidents.item.splice(at + 1 || adminResidents.item.length, 0, ...adminRequests);

collection.variable = collection.variable || [];
[
  { key: "personKind", value: "staff" },
  { key: "recordId", value: "" },
].forEach((entry) => {
  if (!collection.variable.some((v) => v.key === entry.key)) {
    collection.variable.push(entry);
  }
});

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: resident status requests added");
