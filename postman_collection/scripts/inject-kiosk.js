const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const appFolder = collection.item.find((i) => i.name === "App");
if (!appFolder) throw new Error("App folder not found");

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: ['pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));'],
  },
};

const saveKioskToken = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      'const json = pm.response.json();',
      'if (json.data && json.data.token) {',
      '  pm.collectionVariables.set("kioskToken", json.data.token);',
      '}',
    ],
  },
};

const saveVisitorInvite = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      "const data = json.data || {};",
      'if (data.inviteCode) pm.collectionVariables.set("visitorInviteCode", data.inviteCode);',
      'if (data._id) pm.collectionVariables.set("visitorInvitationId", data._id);',
    ],
  },
};

const saveKioskVisitCheckIn = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      "const data = json.data || {};",
      "const session = data.session || data;",
      "const person = data.person || {};",
      'if (session && session._id) pm.collectionVariables.set("visitSessionId", session._id);',
      'if (person && person._id) pm.collectionVariables.set("externalPersonId", person._id);',
    ],
  },
};

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

const kioskHeader = [{ key: "x-kiosk-token", value: "{{kioskToken}}" }];
const orgHeader = [
  { key: "x-org-id", value: "{{organizationId}}" },
  { key: "Authorization", value: "Bearer {{token}}" },
];

const kioskRequests = [
  req("search branches", "GET", ["app", "kiosk", "branches", "search"], {
    query: "keyword=Demo&page=1&limit=10",
  }),
  req("register kiosk", "POST", ["app", "kiosk", "register"], {
    test: saveKioskToken,
    body: {
      branchId: "{{branchId}}",
      activationCode: "{{activationCode}}",
      deviceId: "postman-kiosk-1",
      adminPin: "1234",
      locationLabel: "Reception",
    },
  }),
  req("kiosk me", "GET", ["app", "kiosk", "me"], { header: kioskHeader }),
  req("kiosk qr", "GET", ["app", "kiosk", "qr"], { header: kioskHeader }),
  req("kiosk pairing pending", "GET", ["app", "kiosk", "pairing", "pending"], {
    header: kioskHeader,
  }),
  req("scan kiosk from phone", "POST", ["app", "kiosk", "scan"], {
    header: orgHeader,
    body: { scanToken: "{{kioskScanToken}}" },
  }),
  req("search staff", "GET", ["app", "kiosk", "staff", "search"], {
    header: kioskHeader,
    query: "keyword=Sam&page=1&limit=10",
  }),
  req("staff preview", "GET", ["app", "kiosk", "staff", "{{staffProfileId}}", "preview"], {
    header: kioskHeader,
  }),
  req("request check-in otp", "POST", ["app", "kiosk", "attendance", "otp", "request"], {
    header: kioskHeader,
    body: { staffId: "{{staffProfileId}}" },
  }),
  req("verify check-in otp", "POST", ["app", "kiosk", "attendance", "otp", "verify"], {
    header: kioskHeader,
    body: { staffId: "{{staffProfileId}}", otp: "{{otp}}", clientEventId: "postman-kiosk-otp-1" },
  }),
  req("kiosk clock in pin", "POST", ["app", "kiosk", "attendance", "clock-in"], {
    header: kioskHeader,
    body: {
      staffId: "{{staffProfileId}}",
      pin: "{{staffPin}}",
      clientEventId: "postman-kiosk-clock-in-1",
    },
  }),
  req("kiosk clock in nfc", "POST", ["app", "kiosk", "attendance", "clock-in"], {
    header: kioskHeader,
    body: { nfcTagId: "{{nfcTagId}}", clientEventId: "postman-kiosk-nfc-1" },
  }),
  req("kiosk today", "GET", ["app", "kiosk", "attendance", "today"], {
    header: kioskHeader,
    query: "employeeCode={{employeeCode}}&pin={{staffPin}}",
  }),
  req("kiosk clock out", "POST", ["app", "kiosk", "attendance", "clock-out"], {
    header: kioskHeader,
    body: {
      staffId: "{{staffProfileId}}",
      pin: "{{staffPin}}",
      clientEventId: "postman-kiosk-clock-out-1",
    },
  }),
];

const visitRequests = [
  req("1 visit categories", "GET", ["app", "kiosk", "visits", "categories"], {
    header: kioskHeader,
  }),
  req("2 visit people search", "GET", ["app", "kiosk", "visits", "people", "search"], {
    header: kioskHeader,
    query: "keyword=John&page=1&limit=10",
  }),
  req("3 visit policies", "GET", ["app", "kiosk", "visits", "policies"], {
    header: kioskHeader,
    query: "type=contractor",
  }),
  req("4 visit invite verify", "POST", ["app", "kiosk", "visits", "invite", "verify"], {
    header: kioskHeader,
    body: { inviteCode: "{{visitorInviteCode}}" },
  }),
  req("5 visit invite resend", "POST", ["app", "kiosk", "visits", "invite", "resend"], {
    header: kioskHeader,
    body: { email: "visitor.postman@example.com" },
  }),
  req("6 check-in invitation", "POST", ["app", "kiosk", "visits", "check-in"], {
    header: kioskHeader,
    test: saveKioskVisitCheckIn,
    body: { method: "invitation", inviteCode: "{{visitorInviteCode}}" },
  }),
  req("7 check-in walk-in first visit", "POST", ["app", "kiosk", "visits", "check-in"], {
    header: kioskHeader,
    test: saveKioskVisitCheckIn,
    body: {
      method: "walkIn",
      type: "visitor",
      name: "John Doe",
      phone: "+447700900001",
      purposeOfVisit: "Family visit",
      hostName: "Reception",
    },
  }),
  req("8 check-in walk-in recurring", "POST", ["app", "kiosk", "visits", "check-in"], {
    header: kioskHeader,
    test: saveKioskVisitCheckIn,
    body: {
      method: "walkIn",
      externalPersonId: "{{externalPersonId}}",
      purposeOfVisit: "Family visit",
    },
  }),
  req("9 check-in contractor", "POST", ["app", "kiosk", "visits", "check-in"], {
    header: kioskHeader,
    test: saveKioskVisitCheckIn,
    body: {
      method: "walkIn",
      type: "contractor",
      name: "Site Contractor",
      purposeOfVisit: "Maintenance",
      signatures: [],
    },
  }),
  req("10 visits on-site", "GET", ["app", "kiosk", "visits", "on-site"], {
    header: kioskHeader,
    query: "page=1&limit=10",
  }),
  req("11 visit check-out", "POST", ["app", "kiosk", "visits", "check-out"], {
    header: kioskHeader,
    body: { visitSessionId: "{{visitSessionId}}" },
  }),
];

const adminVisitRequests = [
  req(
    "1 create visitor invitation",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "visitor-invitations"],
    {
      header: orgHeader,
      test: saveVisitorInvite,
      body: {
        branchId: "{{branchId}}",
        visitorName: "John Doe",
        visitorEmail: "visitor.postman@example.com",
        arrivalAt: "2026-10-01T09:00:00.000Z",
        visitingUntil: "2026-10-01T18:00:00.000Z",
        hostName: "Reception",
      },
    }
  ),
  req(
    "2 list visitor invitations",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "visitor-invitations"],
    {
      header: orgHeader,
      query: "page=1&limit=10&branchId={{branchId}}",
    }
  ),
  req(
    "3 resend visitor invitation",
    "POST",
    ["admin", "visitor-invitations", "{{visitorInvitationId}}", "resend"],
    { header: orgHeader, test: saveVisitorInvite }
  ),
  req(
    "4 approve walk-in visit",
    "POST",
    ["admin", "visit-sessions", "{{visitSessionId}}", "approve"],
    { header: orgHeader }
  ),
];

let kioskFolder = appFolder.item.find((i) => i.name === "Kiosk");
if (!kioskFolder) {
  kioskFolder = { name: "Kiosk", item: [] };
  appFolder.item.push(kioskFolder);
}

const staleVisitNames = [
  "visit categories",
  "visit people search",
  "visit policies",
  "visit invite verify",
  "visit invite resend",
  "visit check-in invitation",
  "visit check-in walk-in",
  "visit check-out",
];
kioskFolder.item = (kioskFolder.item || []).filter(
  (r) => !r.request || !staleVisitNames.includes(r.name)
);

for (const request of kioskRequests) {
  const idx = kioskFolder.item.findIndex((r) => r.name === request.name);
  if (idx >= 0) kioskFolder.item[idx] = request;
  else kioskFolder.item.push(request);
}

upsertFolder(kioskFolder, "Visitor / Contractor", visitRequests);

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");
upsertFolder(adminPanel, "Visitor Invitations", adminVisitRequests);

const vars = collection.variable || [];
for (const key of [
  "kioskToken",
  "kioskScanToken",
  "activationCode",
  "employeeCode",
  "staffPin",
  "nfcTagId",
  "otp",
  "visitorInviteCode",
  "visitorInvitationId",
  "visitSessionId",
  "externalPersonId",
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value: "", type: "string" });
  }
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman: App > Kiosk > Visitor / Contractor");
console.log("postman: Admin Panel > Visitor Invitations");
