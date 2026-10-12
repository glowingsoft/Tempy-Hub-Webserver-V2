const fs = require("fs");

const FILE =
  "./postman_collection/Tempy Hub API_Copy4_ZAWAR.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const adminPanel = collection.item.find((i) => i.name === "Admin Panel");
const appFolder = collection.item.find((i) => i.name === "App");
if (!adminPanel || !appFolder) {
  throw new Error("Admin Panel or App folder not found");
}

const testOk = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
    ],
  },
};

const saveId = (varName, status = 201) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("Saved", () => pm.expect(pm.response.code).to.be.oneOf([200, ${status}]));`,
      "const json = pm.response.json();",
      `if (json.data && json.data._id) pm.collectionVariables.set("${varName}", json.data._id);`,
    ],
  },
});

/** register-and-check-in returns { person, session } */
const saveRegisterCheckIn = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("Saved", () => pm.expect(pm.response.code).to.eql(201));',
      "const json = pm.response.json();",
      "const data = json.data || {};",
      'if (data.person && data.person._id) pm.collectionVariables.set("externalPersonId", data.person._id);',
      'if (data.session && data.session._id) pm.collectionVariables.set("visitSessionId", data.session._id);',
    ],
  },
};

const orgHeader = [{ key: "x-org-id", value: "{{organizationId}}" }];
const kioskHeader = [{ key: "x-kiosk-token", value: "{{kioskToken}}" }];

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
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

const adminEvac = [
  req(
    "on-site summary",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "evacuations", "on-site-summary"],
    { query: "branchId={{branchId}}" }
  ),
  req(
    "get active evacuation",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "evacuations", "active"],
    { query: "branchId={{branchId}}" }
  ),
  req(
    "list evacuations",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "evacuations"],
    { query: "page=1&limit=10&branchId={{branchId}}" }
  ),
  req(
    "start evacuation",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "evacuations"],
    {
      body: { branchId: "{{branchId}}", type: "mock" },
      test: saveId("evacuationEventId", 201),
    }
  ),
  req("get evacuation event", "GET", ["admin", "evacuations", "{{evacuationEventId}}"], {
    header: orgHeader,
  }),
  req(
    "list evac checks",
    "GET",
    ["admin", "evacuations", "{{evacuationEventId}}", "checks"],
    {
      header: orgHeader,
      query: "unaccountedOnly=false",
    }
  ),
  req(
    "upsert evac check",
    "POST",
    ["admin", "evacuations", "{{evacuationEventId}}", "checks"],
    {
      header: orgHeader,
      body: {
        personKind: "staff",
        personId: "{{staffProfileId}}",
        status: "safe",
        locationLabel: "Assembly point A",
        clientEventId: "postman-evac-check-1",
      },
    }
  ),
  req(
    "close evacuation",
    "POST",
    ["admin", "evacuations", "{{evacuationEventId}}", "close"],
    { header: orgHeader }
  ),
];

const adminVisitors = [
  req(
    "create external person (visitor)",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "external-people"],
    {
      body: {
        branchId: "{{branchId}}",
        type: "visitor",
        name: "Postman Visitor",
        email: "visitor.postman@example.com",
        phone: "+447700900001",
      },
      test: saveId("externalPersonId", 201),
    }
  ),
  req(
    "create external person (contractor)",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "external-people"],
    {
      body: {
        branchId: "{{branchId}}",
        type: "contractor",
        name: "Postman Contractor",
        email: "contractor.postman@example.com",
        phone: "+447700900002",
      },
      test: saveId("externalPersonId", 201),
    }
  ),
  req(
    "create external person (professional)",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "external-people"],
    {
      body: {
        branchId: "{{branchId}}",
        type: "professional",
        name: "Postman Professional",
        email: "professional.postman@example.com",
        phone: "+447700900003",
        departmentId: "{{departmentId}}",
      },
      test: saveId("externalPersonId", 201),
    }
  ),
  req(
    "list external people",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "external-people"],
    {
      header: orgHeader,
      query:
        "page=1&limit=10&branchId={{branchId}}&departmentId={{departmentId}}&type=visitor,contractor,professional&siteStatus=&keyword=",
    }
  ),
  req(
    "get external person",
    "GET",
    ["admin", "external-people", "{{externalPersonId}}"],
    { header: orgHeader }
  ),
  req(
    "update external person",
    "PATCH",
    ["admin", "external-people", "{{externalPersonId}}"],
    {
      header: orgHeader,
      body: {
        phone: "+447700900099",
        carRegistration: "AB12 CDE",
      },
    }
  ),
  req(
    "register and check-in (walk-in)",
    "POST",
    [
      "admin",
      "organizations",
      "{{organizationId}}",
      "visit-sessions",
      "register-and-check-in",
    ],
    {
      body: {
        branchId: "{{branchId}}",
        type: "visitor",
        name: "Walk-in Visitor",
        purposeOfVisit: "Family visit",
        method: "walkIn",
      },
      test: saveRegisterCheckIn,
    }
  ),
  req(
    "check-in existing person",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "visit-sessions", "check-in"],
    {
      body: {
        branchId: "{{branchId}}",
        externalPersonId: "{{externalPersonId}}",
        method: "walkIn",
        purposeOfVisit: "Site works",
      },
      test: saveId("visitSessionId", 201),
    }
  ),
  req(
    "on-site visit counts",
    "GET",
    [
      "admin",
      "organizations",
      "{{organizationId}}",
      "visit-sessions",
      "on-site-counts",
    ],
    { query: "branchId={{branchId}}" }
  ),
  req(
    "visit analytics by type",
    "GET",
    [
      "admin",
      "organizations",
      "{{organizationId}}",
      "visit-sessions",
      "analytics",
    ],
    { query: "branchId={{branchId}}&groupBy=type&onSiteOnly=true" }
  ),
  req(
    "visit analytics by day",
    "GET",
    [
      "admin",
      "organizations",
      "{{organizationId}}",
      "visit-sessions",
      "analytics",
    ],
    {
      query:
        "branchId={{branchId}}&groupBy=day&from=2026-01-01&to=2026-12-31&timezone=Europe/London",
    }
  ),
  req(
    "list visit sessions",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "visit-sessions"],
    {
      query:
        "page=1&limit=10&branchId={{branchId}}&status=onSite&personType=",
    }
  ),
  req(
    "get visit session",
    "GET",
    ["admin", "visit-sessions", "{{visitSessionId}}"],
    { header: orgHeader }
  ),
  req(
    "check-out visit session",
    "POST",
    ["admin", "visit-sessions", "{{visitSessionId}}", "check-out"],
    { header: orgHeader }
  ),
  req(
    "create visitor invitation",
    "POST",
    ["admin", "organizations", "{{organizationId}}", "visitor-invitations"],
    {
      body: {
        branchId: "{{branchId}}",
        visitorName: "John Doe",
        visitorEmail: "visitor.postman@example.com",
        arrivalAt: "2026-10-01T09:00:00.000Z",
        visitingUntil: "2026-10-01T18:00:00.000Z",
      },
    }
  ),
  req(
    "list visitor invitations",
    "GET",
    ["admin", "organizations", "{{organizationId}}", "visitor-invitations"],
    { query: "page=1&limit=10&branchId={{branchId}}" }
  ),
  req(
    "resend visitor invitation",
    "POST",
    ["admin", "visitor-invitations", "{{visitorInvitationId}}", "resend"],
    { header: orgHeader }
  ),
  req(
    "approve walk-in visit",
    "POST",
    ["admin", "visit-sessions", "{{visitSessionId}}", "approve"],
    { header: orgHeader }
  ),
];

const appEvac = [
  req("get active evacuation", "GET", ["app", "evacuations", "active"], {
    header: orgHeader,
    query: "branchId={{branchId}}",
  }),
  req("mark myself safe", "POST", ["app", "evacuations", "me", "check"], {
    header: orgHeader,
    body: {
      branchId: "{{branchId}}",
      status: "safe",
      locationLabel: "Car park",
      clientEventId: "postman-evac-self-1",
    },
  }),
  req("mark myself waiting (smoke)", "POST", ["app", "evacuations", "me", "check"], {
    header: orgHeader,
    body: {
      branchId: "{{branchId}}",
      status: "waiting",
      locationLabel: "Ward 2 corridor",
      clientEventId: "postman-evac-self-smoke-1",
    },
  }),
];

const kioskEvac = [
  req("evac on-site summary", "GET", ["app", "kiosk", "evacuations", "on-site-summary"], {
    header: kioskHeader,
  }),
  req("evac get active", "GET", ["app", "kiosk", "evacuations", "active"], {
    header: kioskHeader,
  }),
  req("evac start", "POST", ["app", "kiosk", "evacuations"], {
    header: kioskHeader,
    body: { type: "mock" },
    test: saveId("evacuationEventId", 201),
  }),
  req("evac close", "POST", ["app", "kiosk", "evacuations", "close"], {
    header: kioskHeader,
  }),
];

upsertFolder(adminPanel, "Evacuation", adminEvac);
upsertFolder(adminPanel, "Visitors & Visit Sessions", adminVisitors);
upsertFolder(appFolder, "Evacuation", appEvac);

const kioskFolder = appFolder.item.find((i) => i.name === "Kiosk");
if (kioskFolder) {
  for (const request of kioskEvac) {
    const idx = kioskFolder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) kioskFolder.item[idx] = request;
    else kioskFolder.item.push(request);
  }
} else {
  upsertFolder(appFolder, "Kiosk", kioskEvac);
}

const vars = collection.variable || [];
const ensureVar = (key) => {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value: "", type: "string" });
  }
};
ensureVar("evacuationEventId");
ensureVar("kioskToken");
ensureVar("externalPersonId");
ensureVar("visitSessionId");
ensureVar("visitorInviteCode");
ensureVar("visitorInvitationId");
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log(
  "Zawar postman: Evacuation + Visitors & Visit Sessions folders injected"
);
