const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILES = [collectionFile()];

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
    ],
  },
};

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const req = (name, method, pathParts, { query, header } = {}) => ({
  name,
  event: [testOk],
  request: {
    method,
    header: header || [],
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
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

for (const FILE of FILES) {
  if (!fs.existsSync(FILE)) continue;
  const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const appFolder = collection.item.find((i) => i.name === "App");
  const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
  if (appFolder) {
    upsertFolder(appFolder, "Team Live", [
      req("team live", "GET", ["app", "team-live"], {
        header: orgHeader,
        query: "period=daily",
      }),
      req("team live activity", "GET", ["app", "team-live", "activity"], {
        header: orgHeader,
        query: "page=1&limit=20",
      }),
      req("team live rota", "GET", ["app", "team-live", "rota"], {
        header: orgHeader,
        query: "date=2026-08-18&view=day",
      }),
    ]);
  }
  if (adminPanel) {
    upsertFolder(adminPanel, "Team Live", [
      req(
        "team live",
        "GET",
        ["admin", "organizations", "{{organizationId}}", "team-live"],
        { query: "period=daily" }
      ),
      req(
        "team live activity",
        "GET",
        [
          "admin",
          "organizations",
          "{{organizationId}}",
          "team-live",
          "activity",
        ],
        { query: "page=1&limit=20" }
      ),
      req(
        "team live rota",
        "GET",
        ["admin", "organizations", "{{organizationId}}", "team-live", "rota"],
        { query: "date=2026-08-18&view=day" }
      ),
    ]);
  }
  fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
  console.log("injected team live:", FILE);
}
