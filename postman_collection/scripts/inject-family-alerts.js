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

const anchor = "mark myself waiting (smoke)";
const parent = findParent(collection.item, anchor);
if (!parent) throw new Error("app evacuation folder not found");

const dropNamed = (items, names) => {
  for (const item of items) {
    if (!item.item) continue;
    item.item = item.item.filter((child) => !names.has(child.name));
    dropNamed(item.item, names);
  }
};

const make = (name, path, body, description, method = "POST") => ({
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
      raw: `{{url}}/app/evacuations/{{evacuationEventId}}/${path}`,
      host: ["{{url}}"],
      path: ["app", "evacuations", "{{evacuationEventId}}", path],
    },
    description,
  },
  response: [],
});

const requests = [
  make(
    "get roll call (evacuation)",
    "rollcall",
    null,
    "One call for the manager app Evacuation screen. Returns the evacuation (type, status, startedAt, kioskId, branch with assemblyPoint), rollcallStats { total, safe, missing, unknown, byKind }, familyAlert { offsiteAlertsEnabled, familiesToNotify, status notSent/alertSent/allClearSent, alertedAt, familiesNotified, updates, allClearAt } and unaccounted (Not Yet Accounted For rows: personKind, status, name, email, roomNumber, employeeCode, jobTitle, lastSeenLabel, lastSeenAt, signedInAt, visitPurpose). The unaccounted list is paged: meta has the totals. Query: status (missing, unknown or safe; default missing and unknown), personKind (staff, resident, visitor or contractor), page, limit. Site manager of the site, owner or super admin; send x-org-id.",
    "GET"
  ),
  make(
    "alert families (evacuation)",
    "alert-families",
    null,
    "Alert Families Now. Real evacuations only (drills return 400 family_alert_not_for_drills). Sends one notification to every family member linked to a resident of the site and records familyAlert.status = alertSent with the time and the number of families told. Site manager app: send x-org-id and use the id from get active evacuation. Needs the organization setting emergencyNotifyOffsite. Once only (409 family_alert_already_sent). The response is the evacuation event with rollcallStats and familyAlert."
  ),
  make(
    "update families (evacuation)",
    "update-families",
    { presets: ["allResidentsAtAssemblyPoint", "fireServiceOnSite"] },
    "Send Update. presets (at least one): allResidentsAtAssemblyPoint, fireServiceOnSite, residentsBackInside. Families must have been alerted first (409 family_alert_not_sent) and the evacuation must still be active (409 evacuation_not_active). Each call is appended to familyAlert.updates."
  ),
  make(
    "all clear families (evacuation)",
    "all-clear",
    null,
    "Post All Clear. Tells the families the emergency is over and sets familyAlert.status = allClearSent with allClearAt. Families must have been alerted first (409 family_alert_not_sent); once only (409 family_all_clear_already_sent). Allowed while the evacuation is active or after it is closed."
  ),
];

const names = new Set([
  ...requests.map((r) => r.name),
  "list not yet accounted for (evacuation)",
  "get family alert (evacuation)",
]);
dropNamed(collection.item, names);
const at = parent.item.findIndex((i) => i.name === anchor);
parent.item.splice(at + 1, 0, ...requests);

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: family alert requests added");
