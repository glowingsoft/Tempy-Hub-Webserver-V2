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

const testScript = (lines) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
      "const json = pm.response.json();",
      "const data = json.data || {};",
      ...lines,
    ],
  },
});

const saveKioskToken = testScript([
  'if (data.token) pm.collectionVariables.set("kioskToken", data.token);',
]);

const saveScanToken = testScript([
  'if (data.scanToken) pm.collectionVariables.set("kioskScanToken", data.scanToken);',
]);

const savePairingFromScan = testScript([
  'if (data.sessionId) pm.collectionVariables.set("kioskPairingSessionId", String(data.sessionId));',
]);

const savePairingPending = testScript([
  "const session = data.session || {};",
  'if (session.sessionId) pm.collectionVariables.set("kioskPairingSessionId", String(session.sessionId));',
]);

const saveVisitorInvite = testScript([
  'if (data.inviteCode) pm.collectionVariables.set("visitorInviteCode", data.inviteCode);',
  'if (data._id) pm.collectionVariables.set("visitorInvitationId", data._id);',
]);

const saveKioskVisitCheckIn = testScript([
  "const session = data.session || data;",
  "const person = data.person || {};",
  'if (session && session._id) pm.collectionVariables.set("visitSessionId", session._id);',
  'if (person && person._id) pm.collectionVariables.set("externalPersonId", person._id);',
]);

const saveKioskId = testScript([
  'if (data._id) pm.collectionVariables.set("kioskId", data._id);',
]);

const upsertFolder = (parent, folderName, requests) => {
  let folder = parent.item.find((i) => i.name === folderName);
  if (!folder) {
    folder = { name: folderName, item: [] };
    parent.item.push(folder);
  }
  folder.item = requests;
  return folder;
};

const req = (name, method, pathParts, { body, query, test, header } = {}) => {
  const path = `/${pathParts.join("/")}`;
  return {
    name: `${method} ${path}`,
    event: [test || testOk],
    request: {
      method,
      header: header || [],
      description: name,
      body: body
        ? {
            mode: "raw",
            raw: JSON.stringify(body, null, 2),
            options: { raw: { language: "json" } },
          }
        : undefined,
      url: {
        raw: `{{url}}${path}${query ? `?${query}` : ""}`,
        host: ["{{url}}"],
        path: pathParts,
        ...(query
          ? {
              query: query.split("&").map((pair) => {
                const [key, value] = pair.split("=");
                return { key, value: value ?? "" };
              }),
            }
          : {}),
      },
    },
    response: [],
  };
};

const kioskHeader = [{ key: "x-kiosk-token", value: "{{kioskToken}}" }];
const orgHeader = [
  { key: "x-org-id", value: "{{organizationId}}" },
  { key: "Authorization", value: "Bearer {{token}}" },
];
const orgAdminHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];

const setupRequests = [
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
  req("kiosk session", "POST", ["app", "kiosk", "session"], {
    test: saveKioskToken,
    body: {
      branchId: "{{branchId}}",
      deviceId: "postman-kiosk-1",
      adminPin: "1234",
    },
  }),
];

const sessionRequests = [
  req("kiosk me", "GET", ["app", "kiosk", "me"], { header: kioskHeader }),
  req("kiosk home widgets", "GET", ["app", "kiosk", "widgets"], {
    header: kioskHeader,
  }),
  req("patch kiosk me", "PATCH", ["app", "kiosk", "me"], {
    header: kioskHeader,
    body: { fireEvacuation: true },
  }),
];

const qrRequests = [
  req("kiosk qr", "GET", ["app", "kiosk", "qr"], {
    header: kioskHeader,
    test: saveScanToken,
  }),
  req("scan kiosk from phone", "POST", ["app", "kiosk", "scan"], {
    header: orgHeader,
    test: savePairingFromScan,
    body: { scanToken: "{{kioskScanToken}}" },
  }),
  req("kiosk pairing pending", "GET", ["app", "kiosk", "pairing", "pending"], {
    header: kioskHeader,
    test: savePairingPending,
  }),
  req("confirm pairing", "POST", ["app", "kiosk", "pairing", "{{kioskPairingSessionId}}", "confirm"], {
    header: kioskHeader,
    body: { clientEventId: "postman-kiosk-qr-1", image: "{{imageUrl}}" },
  }),
  req("cancel pairing", "POST", ["app", "kiosk", "pairing", "{{kioskPairingSessionId}}", "cancel"], {
    header: kioskHeader,
  }),
];

const staffRequests = [
  req("search staff", "GET", ["app", "kiosk", "staff", "search"], {
    header: kioskHeader,
    query: "keyword=Sam&page=1&limit=10",
  }),
  req("staff preview", "GET", ["app", "kiosk", "staff", "{{staffProfileId}}", "preview"], {
    header: kioskHeader,
  }),
];

const attendanceRequests = [
  req("request check-in otp", "POST", ["app", "kiosk", "attendance", "otp", "request"], {
    header: kioskHeader,
    body: { staffId: "{{staffProfileId}}" },
  }),
  req("verify check-in otp", "POST", ["app", "kiosk", "attendance", "otp", "verify"], {
    header: kioskHeader,
    body: {
      staffId: "{{staffProfileId}}",
      otp: "{{otp}}",
      clientEventId: "postman-kiosk-otp-1",
      image: "{{imageUrl}}",
    },
  }),
  req("verify staff pin", "POST", ["app", "kiosk", "attendance", "verify"], {
    header: kioskHeader,
    body: { staffId: "{{staffProfileId}}", pin: "{{staffPin}}" },
  }),
  req("kiosk clock in pin", "POST", ["app", "kiosk", "attendance", "clock-in"], {
    header: kioskHeader,
    body: {
      staffId: "{{staffProfileId}}",
      pin: "{{staffPin}}",
      clientEventId: "postman-kiosk-clock-in-1",
      image: "{{imageUrl}}",
    },
  }),
  req("kiosk clock in nfc", "POST", ["app", "kiosk", "attendance", "clock-in"], {
    header: kioskHeader,
    body: {
      nfcTagId: "{{nfcTagId}}",
      clientEventId: "postman-kiosk-nfc-1",
      image: "{{imageUrl}}",
    },
  }),
  req("kiosk today", "GET", ["app", "kiosk", "attendance", "today"], {
    header: kioskHeader,
    query: "staffId={{staffProfileId}}&employeeCode={{employeeCode}}&pin={{staffPin}}",
  }),
  req("kiosk on-site", "GET", ["app", "kiosk", "attendance", "on-site"], {
    header: kioskHeader,
    query: "keyword=&page=1&limit=10",
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
    body: {
      method: "invitation",
      inviteCode: "{{visitorInviteCode}}",
      image: "{{imageUrl}}",
    },
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
      image: "{{imageUrl}}",
    },
  }),
  req("8 check-in walk-in recurring", "POST", ["app", "kiosk", "visits", "check-in"], {
    header: kioskHeader,
    test: saveKioskVisitCheckIn,
    body: {
      method: "walkIn",
      externalPersonId: "{{externalPersonId}}",
      purposeOfVisit: "Family visit",
      image: "{{imageUrl}}",
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
      image: "{{imageUrl}}",
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

const evacuationRequests = [
  req("evacuations on-site summary", "GET", ["app", "kiosk", "evacuations", "on-site-summary"], {
    header: kioskHeader,
  }),
  req("evacuations active", "GET", ["app", "kiosk", "evacuations", "active"], {
    header: kioskHeader,
  }),
  req("evacuations emergency pin", "POST", ["app", "kiosk", "evacuations", "emergency-pin"], {
    header: kioskHeader,
    body: { pin: "{{emergencyPin}}" },
  }),
  req("evacuations start", "POST", ["app", "kiosk", "evacuations"], {
    header: kioskHeader,
    body: { type: "mock" },
  }),
  req("evacuations close", "POST", ["app", "kiosk", "evacuations", "close"], {
    header: kioskHeader,
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

const adminKioskRequests = [
  req("list kiosks", "GET", ["admin", "kiosks"], {
    header: orgAdminHeader,
    query:
      "page=1&limit=10&branchId={{branchId}}&keyword=&setupStatus=&kioskMode=&presence=",
  }),
  req("create kiosk", "POST", ["admin", "kiosks"], {
    header: orgAdminHeader,
    test: saveKioskId,
    body: {
      branchId: "{{branchId}}",
      receptionIdentifier: "Main Entrance",
      locationLabel: "Reception",
      deviceType: "ipad",
    },
  }),
  req("get kiosk", "GET", ["admin", "kiosks", "{{kioskId}}"], {
    header: orgAdminHeader,
  }),
  req("update kiosk", "PATCH", ["admin", "kiosks", "{{kioskId}}"], {
    header: orgAdminHeader,
    body: {
      receptionIdentifier: "Main Entrance",
      locationLabel: "Reception",
      deviceType: "ipad",
      fireEvacuation: true,
    },
  }),
  req("toggle kiosk lock", "POST", ["admin", "kiosks", "{{kioskId}}", "toggle-lock"], {
    header: orgAdminHeader,
  }),
];

let kioskFolder = appFolder.item.find((i) => i.name === "Kiosk");
if (!kioskFolder) {
  kioskFolder = { name: "Kiosk", item: [] };
  appFolder.item.push(kioskFolder);
}

const flatKioskRequests = [
  ...setupRequests,
  ...sessionRequests,
  ...qrRequests,
  ...staffRequests,
  ...attendanceRequests,
  ...evacuationRequests,
];

kioskFolder.item = flatKioskRequests;
upsertFolder(kioskFolder, "Visitor / Contractor", visitRequests);

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
if (!adminPanel) throw new Error("Admin Panel folder not found");
upsertFolder(adminPanel, "Visitor Invitations", adminVisitRequests);
upsertFolder(adminPanel, "Kiosks", adminKioskRequests);

const vars = collection.variable || [];
for (const key of [
  "kioskToken",
  "kioskScanToken",
  "kioskPairingSessionId",
  "kioskId",
  "activationCode",
  "employeeCode",
  "staffPin",
  "nfcTagId",
  "otp",
  "emergencyPin",
  "visitorInviteCode",
  "visitorInvitationId",
  "visitSessionId",
  "externalPersonId",
  "imageUrl",
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value: "", type: "string" });
  }
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman: App > Kiosk (all live routes)");
console.log("postman: Admin Panel > Kiosks + Visitor Invitations");
