const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const app = collection.item.find((item) => item.name === "App");
if (!app) throw new Error("App folder not found");

const FOLDER = "Family Settings";

const make = ({ name, method, path, query = [], body, description }) => {
  const raw = `{{url}}/app/${path}`;
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
        path: ["app", ...path.split("/")],
        ...(query.length ? { query } : {}),
      },
      description,
    },
    response: [],
  };
};

const requests = [
  make({
    name: "get family settings",
    method: "GET",
    path: "family-settings",
    query: [{ key: "branchId", value: "{{branchId}}", disabled: true }],
    description:
      "Family Settings screen of the manager app. gazette: issueEveryDays, messageCap, anchorDate, deadlineReminder, communityWall. visiting: bookingOpen, loungeCapacityPerSlot, protectedTimes, visitingHours, daysAhead, maxPartySize, paused. safety: emergencyNotifyOffsite. access {editVisiting, editGazette}: gazette and safety are read-only for site managers. branchId: owner and super admin only.",
  }),
  make({
    name: "update family settings",
    method: "PUT",
    path: "family-settings",
    body: {
      visiting: {
        bookingOpen: true,
        loungeCapacityPerSlot: 4,
        protectedTimes: [
          { start: "12:00", end: "13:30", label: "Lunch" },
          { start: "17:00", end: "18:00", label: "Dinner" },
        ],
      },
    },
    description:
      "Send only what changed. visiting (site manager of the site, owner, super admin): bookingOpen (false pauses visiting and cancels booked visits), loungeCapacityPerSlot, protectedTimes, visitingHours, daysAhead, maxPartySize, pausedReason. gazette (owner and super admin only, 403 insufficient_role otherwise): issueEveryDays, messageCap, anchorDate, deadlineReminder, communityWall.",
  }),
];

let folder = app.item.find((item) => item.name === FOLDER);
if (!folder) {
  folder = { name: FOLDER, item: [] };
  const at = app.item.findIndex((item) => item.name === "Residents & People");
  app.item.splice(at + 1, 0, folder);
}
folder.item = requests;

fs.writeFileSync(FILE, `${JSON.stringify(collection, null, 2)}\n`);
console.log("postman: family settings requests added");
