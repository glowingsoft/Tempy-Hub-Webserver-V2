const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) throw new Error("Admin Panel or App folder not found");

const upsertVar = (key) => {
  if (!collection.variable) collection.variable = [];
  if (collection.variable.some((entry) => entry.key === key)) return;
  collection.variable.push({ key, value: "", type: "string" });
};

["kioskId", "kioskToken", "branchId", "organizationId"].forEach(upsertVar);

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

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
      raw: `{{url}}/${pathParts.join("/")}${query ? `?${query}` : ""}`,
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
  },
  response: [],
});

const upsertFolder = (parent, folderName, requests) => {
  let folder = parent.item.find((i) => i.name === folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    parent.item.push(folder);
  }
  if (!folder.item) folder.item = [];
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
  return folder;
};

const orgPath = ["admin", "organizations", "{{organizationId}}", "kiosk-widgets"];
const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];
const kioskHeader = [{ key: "x-kiosk-token", value: "{{kioskToken}}" }];

const saveBody = {
  branchId: "{{branchId}}",
  kioskId: null,
  homeWidgets: [
    {
      type: "image",
      title: "Welcome",
      sortOrder: 1,
      config: {
        imageUrl: "https://example.com/welcome.png",
        caption: "Welcome",
      },
    },
    {
      type: "text",
      title: "Quote Of The Day",
      sortOrder: 2,
      config: {
        textKind: "quoteOfTheDay",
        body: "Care is a team sport.",
      },
    },
    {
      type: "text",
      title: "Greetings",
      sortOrder: 3,
      config: {
        textKind: "greeting",
        body: "Good morning from reception.",
      },
    },
  ],
  checkoutWidget: {
    type: "qr",
    title: "Checkout survey",
    config: {
      url: "https://forms.google.com/checkout-survey",
      caption: "Scan to tell us about your visit",
    },
    showToVisitors: true,
    showToEmployees: false,
  },
};

upsertFolder(adminPanel, "Kiosk Widgets", [
  req("1 list kiosk widgets", "GET", orgPath, {
    header: orgHeader,
    query: "branchId={{branchId}}",
  }),
  req("2 save kiosk widgets (site default)", "PUT", orgPath, {
    header: orgHeader,
    body: saveBody,
  }),
  req("3 list kiosk widgets (one kiosk)", "GET", orgPath, {
    header: orgHeader,
    query: "branchId={{branchId}}&kioskId={{kioskId}}",
  }),
  req("4 save kiosk widgets (one kiosk override)", "PUT", orgPath, {
    header: orgHeader,
    body: { ...saveBody, kioskId: "{{kioskId}}" },
  }),
]);

const kioskFolder = appFolder.item.find((i) => i.name === "Kiosk");
if (!kioskFolder) throw new Error("App > Kiosk folder not found");

upsertFolder(kioskFolder, "Widgets", [
  req("kiosk home widgets", "GET", ["app", "kiosk", "widgets"], {
    header: kioskHeader,
  }),
]);

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman: Admin Panel > Kiosk Widgets");
console.log("postman: App > Kiosk > Widgets");
