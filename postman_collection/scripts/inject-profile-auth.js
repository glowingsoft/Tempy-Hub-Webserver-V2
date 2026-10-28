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

const req = (name, method, pathParts, { body, header } = {}) => ({
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
      raw: `{{url}}/${pathParts.join("/")}`,
      host: ["{{url}}"],
      path: pathParts,
    },
  },
  response: [],
});

const upsertInFolder = (parent, folderName, requests) => {
  const folder = parent.item.find((i) => i.name === folderName);
  if (!folder) return;
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
  if (!appFolder) continue;

  upsertInFolder(appFolder, "Auth", [
    req("change password", "POST", ["auth", "change-password"], {
      body: { oldPassword: "OldPass1", newPassword: "NewPass1" },
    }),
    req("profile", "GET", ["app", "users", "profile"], { header: orgHeader }),
    req("updateProfile", "PUT", ["app", "users", "profile"], {
      header: orgHeader,
      body: { name: "John Doe", phoneNumber: "+441234567890" },
    }),
  ]);

  if (adminPanel) {
    upsertInFolder(adminPanel, "Auth", [
      req("change password", "POST", ["auth", "change-password"], {
        body: { oldPassword: "OldPass1", newPassword: "NewPass1" },
      }),
    ]);
  }

  fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
  console.log("injected profile/auth:", FILE);
}
