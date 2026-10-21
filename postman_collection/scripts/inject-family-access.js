const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const appFolder = collection.item.find((i) => i.name === "App");
if (!appFolder) throw new Error("App folder not found");
const adminFolder = collection.item.find((i) => i.name === "Admin Panel");
if (!adminFolder) throw new Error("Admin Panel folder not found");

const test = (lines) => ({
  listen: "test",
  script: { type: "text/javascript", exec: lines },
});

const req = (name, method, pathParts, { query, tests, description } = {}) => ({
  name,
  event: tests ? [test(tests)] : [],
  request: {
    method,
    header: [],
    url: {
      raw: `{{url}}/${pathParts.join("/")}${query ? `?${query}` : ""}`,
      host: ["{{url}}"],
      path: pathParts,
      // Postman reads the Params tab from this list, not from the raw string.
      ...(query
        ? {
            query: query.split("&").map((pair) => {
              const [key, ...rest] = pair.split("=");
              return { key, value: rest.join("=") };
            }),
          }
        : {}),
    },
    ...(description ? { description } : {}),
  },
  response: [],
});

const requests = [
  req("relationship options", "GET", ["app", "family", "relationships"], {
    tests: [
      'pm.test("Relationship options fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      "    pm.expect(data).to.be.an(\"array\");",
      "    pm.expect(data[0]).to.have.keys([\"value\", \"label\"]);",
      "});",
    ],
    description:
      "Options for the Relationship dropdowns (Grandson, Daughter, Niece...). Needs a family token but no active link, so the Join A Family screen can use it. Figma screens: Join A Family, Invite Family.",
  }),
  req("my residents", "GET", ["app", "family", "residents"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("My residents fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      "    pm.expect(data).to.be.an(\"array\");",
      "    if (data.length) {",
      "        pm.expect(data.filter((r) => r.isActive)).to.have.lengthOf(1);",
      "    }",
      "});",
    ],
    description:
      "Residents the member is actively linked to, with the active one flagged (Who are you viewing?). residentId is optional: the resident the app is showing; without it the first one is flagged. Residents of a home with Family Engagement off are left out. Returns an empty list when the member has no active link yet. Built as one aggregation (links joined to organization, resident and home). Figma screen: Home Family Tab (Who are you viewing? and the header dropdown).",
  }),
];

const jsonBody = (body) => ({
  mode: "raw",
  raw: JSON.stringify(body, null, 2),
  options: { raw: { language: "json" } },
});

requests.push(
  req("current family code", "GET", ["app", "family", "codes", "current"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Current family code fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      "    pm.expect(data).to.have.property(\"code\");",
      "    if (data.code) {",
      "        pm.expect(data.code).to.match(/^[A-Z]{2,3}-\\d{2}-[A-Z0-9]{4}$/);",
      '        pm.collectionVariables.set("familyCode", data.code);',
      "    }",
      "});",
    ],
    description:
      "The resident's current family code and when it expires. code is null when there is none or it has expired, so the app shows Make A New Code. Next of kin only: 403 for another family member, 404 when the resident isn't one of yours, 400 when residentId is missing. Figma screen: Invite Family (family code card).",
  }),
  {
    ...req("make new family code", "POST", ["app", "family", "codes"], {
      tests: [
        'pm.test("New family code created", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        "    pm.expect(data.code).to.match(/^[A-Z]{2,3}-\\d{2}-[A-Z0-9]{4}$/);",
        '    pm.collectionVariables.set("familyCode", data.code);',
        "});",
      ],
      description:
        "Make A New Code: creates a code valid for 14 days and voids the old one. The code never contains the resident's room number. Next of kin only. Figma screen: Invite Family (Make A New Code).",
    }),
  }
);
requests[requests.length - 1].request.body = jsonBody({ residentId: "{{residentId}}" });

// ---------------------------------------------------------------- Join A Family
const withBody = (request, body) => {
  request.request.body = jsonBody(body);
  return request;
};

requests.push(
  req("check family code", "GET", ["app", "family", "join", "preview"], {
    query: "code={{familyCode}}",
    tests: [
      'pm.test("Code accepted", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      "    pm.expect(data.valid).to.eql(true);",
      "    pm.expect(data.homeName).to.be.a(\"string\");",
      "    pm.expect(data).to.not.have.property(\"residentId\");",
      "});",
    ],
    description:
      "The Code Accepted card: checks a typed code and returns the home name only (the resident stays hidden until approval). Wrong 404, expired or replaced 410, and 429 after 5 wrong tries in 15 minutes (the message says how many minutes are left). Figma screen: Join A Family (code entry, Wrong, Expired, Locked).",
  }),
  withBody(
    req("send join request", "POST", ["app", "family", "join"], {
      tests: [
        'pm.test("Join request sent", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.status).to.eql("pending");',
        '    pm.collectionVariables.set("joinRequestId", data.requestId);',
        "});",
      ],
      description:
        "Send Join Request: body code and relationship (one of the values from relationship options). Creates a pending request for the next of kin or the home to approve. Errors: 400 invalid_relationship, 404/410/429 for the code, 409 join_request_pending (one at a time), 409 family_link_exists, 409 email_used_by_staff. Figma screen: Join A Family.",
    }),
    { code: "{{familyCode}}", relationship: "grandson" }
  ),
  req("current join request", "GET", ["app", "family", "join-requests", "current"], {
    tests: [
      'pm.test("Current join request fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      "    if (data) {",
      '        pm.expect(data.status).to.eql("pending");',
      '        pm.collectionVariables.set("joinRequestId", data.requestId);',
      "    }",
      "});",
    ],
    description:
      "The member's pending request (home name, Waiting), or null when there is none. Figma screen: Join A Family (Request Sent, Waiting).",
  }),
  req("cancel join request", "POST", ["app", "family", "join-requests", "{{joinRequestId}}", "cancel"], {
    tests: [
      'pm.test("Join request cancelled", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("cancelled");',
      "});",
    ],
    description:
      "Cancel Request, after the confirmation dialog. Only the member who asked, and only while it is pending (409 otherwise, 404 for anyone else's request). Figma screen: Join A Family (Cancel Request).",
  })
);

// ---------------------------------------------------------------- My Family
requests.push(
  req("my family", "GET", ["app", "family", "members"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("My Family fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data.members).to.be.an("array");',
      "    const removable = data.members.find((m) => m.canRemove);",
      '    if (removable) pm.collectionVariables.set("memberId", removable.memberId);',
      "    const review = data.members.find((m) => m.canReview);",
      '    if (review) pm.collectionVariables.set("joinRequestId", review.memberId);',
      "});",
    ],
    description:
      "My Family: the people linked to the resident, with name, photo, relationship, Next Of Kin badge, status and isYou. The next of kin also sees people who asked to join (status pending, canReview true); everyone else sees active members only. canRemove and canReview say which buttons to show. Figma screen: My Family.",
  }),
  req("join requests to review", "GET", ["app", "family", "join-requests"], {
    query: "residentId={{residentId}}&page=1&limit=10",
    tests: [
      'pm.test("Join requests fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.be.an("array");',
      "    const first = pm.response.json().data[0];",
      '    if (first) pm.collectionVariables.set("joinRequestId", first.requestId);',
      "});",
    ],
    description:
      "Requests waiting for review, oldest first, paginated. Next of kin only (403 for another member, 404 when the resident isn't yours, 400 without residentId). Figma screen: My Family (Review).",
  }),
  req("approve join request", "POST", ["app", "family", "join-requests", "{{joinRequestId}}", "approve"], {
    tests: [
      'pm.test("Join request approved", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("active");',
      "});",
    ],
    description:
      "Approves a pending request: the person becomes an active member and sees the resident from their next call. Only the resident's next of kin; 404 for anyone else (so other families' requests stay hidden), 409 if the request was already decided. Figma screen: My Family (Review).",
  }),
  req("reject join request", "POST", ["app", "family", "join-requests", "{{joinRequestId}}", "reject"], {
    tests: [
      'pm.test("Join request rejected", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("rejected");',
      "});",
    ],
    description:
      "Rejects a pending request. The person can send a new request later. Only the resident's next of kin; 404 for anyone else, 409 if already decided. Figma screen: My Family (Review).",
  }),
  req("remove family member", "DELETE", ["app", "family", "members", "{{memberId}}"], {
    tests: [
      'pm.test("Family member removed", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("removed");',
      "});",
    ],
    description:
      "Removes an active member; their access ends on their next request. Only the resident's next of kin. 409 for the next of kin (hand over first) or for someone who hasn't been approved (reject the request instead); 404 for anyone else's member. Figma screen: My Family (Remove).",
  })
);

// ---------------------------------------------------------------- Next of kin handover and leaving
requests.push(
  req("handover candidates", "GET", ["app", "family", "handover", "candidates"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Handover candidates fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data.members).to.be.an("array");',
      "    pm.expect(data.canLetHomeChoose).to.eql(true);",
      "    const pick = data.members.find((m) => m.canSelect);",
      '    if (pick) pm.collectionVariables.set("memberId", pick.memberId);',
      "});",
    ],
    description:
      "Who the next of kin can hand over to: active members (canSelect true) and people still waiting for approval (shown, canSelect false), plus the option to let the home choose. Next of kin only. Figma screen: Leave Margaret's Family (Handover To).",
  }),
  withBody(
    req("ask to take over", "POST", ["app", "family", "handover"], {
      tests: [
        'pm.test("Handover requested", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.status).to.eql("pending");',
        '    pm.collectionVariables.set("handoverId", data.handoverId);',
        "});",
      ],
      description:
        "Asks one member to take over as next of kin. Body: residentId and toMemberId (a memberId from handover candidates). The next of kin keeps the role until the person accepts. Errors: 400 handover_target_required / handover_to_self, 404 family_member_not_found, 409 handover_member_not_approved or handover_pending (one open handover per resident). Figma screen: Leave Margaret's Family (Ask James To Take Over).",
    }),
    { residentId: "{{residentId}}", toMemberId: "{{memberId}}" }
  ),
  withBody(
    req("ask the home to choose", "POST", ["app", "family", "handover"], {
      tests: [
        'pm.test("Handover requested", function () {',
        "    pm.response.to.have.status(201);",
        '    pm.expect(pm.response.json().data.homeChooses).to.eql(true);',
        '    pm.collectionVariables.set("handoverId", pm.response.json().data.handoverId);',
        "});",
      ],
      description:
        "Lets the home choose the new next of kin. Body: residentId and homeChooses true. The next of kin keeps the role until the home assigns someone. Figma screen: Leave Margaret's Family (Let Florence House Choose).",
    }),
    { residentId: "{{residentId}}", homeChooses: true }
  ),
  req("current handover", "GET", ["app", "family", "handover", "current"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Current handover fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      "    if (data) {",
      '        pm.expect(["outgoing", "incoming"]).to.include(data.direction);',
      '        pm.collectionVariables.set("handoverId", data.handoverId);',
      "    }",
      "});",
    ],
    description:
      "The open handover the caller is part of, or null. direction is outgoing for the next of kin who asked and incoming for the person asked; to is null when the home chooses. residentId is optional. Figma screen: Leave Margaret's Family (James Must Accept).",
  }),
  req("accept handover", "POST", ["app", "family", "handover", "{{handoverId}}", "accept"], {
    tests: [
      'pm.test("Handover accepted", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("accepted");',
      "});",
    ],
    description:
      "The person asked accepts and becomes next of kin; the previous next of kin stays a regular member. Done together or not at all. 404 for anyone but the person asked, 409 if no longer open or no longer valid (the next of kin changed or someone left).",
  }),
  req("decline handover", "POST", ["app", "family", "handover", "{{handoverId}}", "decline"], {
    tests: [
      'pm.test("Handover declined", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("declined");',
      "});",
    ],
    description:
      "The person asked declines; the next of kin keeps the role. 404 for anyone but the person asked, 409 if no longer open.",
  }),
  req("cancel handover", "POST", ["app", "family", "handover", "{{handoverId}}", "cancel"], {
    tests: [
      'pm.test("Handover cancelled", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("cancelled");',
      "});",
    ],
    description:
      "Keep My Role: the next of kin withdraws the request. 404 for anyone but the next of kin who asked, 409 if no longer open. Figma screen: Leave Margaret's Family (Keep My Role).",
  }),
  withBody(
    req("leave family", "POST", ["app", "family", "leave"], {
      tests: [
        'pm.test("Left the family", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("removed");',
        "});",
      ],
      description:
        "Leave this family. Body: residentId. The next of kin gets 409 next_of_kin_must_hand_over until someone has taken over. Leaving also withdraws any handover that was asked of this member. Figma screen: Profile & Settings (Leave This Family).",
    }),
    { residentId: "{{residentId}}" }
  )
);

let folder = appFolder.item.find((i) => i.name === "Family");
if (!folder) {
  folder = { name: "Family", item: [] };
  appFolder.item.push(folder);
}
for (const request of requests) {
  const idx = folder.item.findIndex((r) => r.name === request.name);
  if (idx >= 0) folder.item[idx] = request;
  else folder.item.push(request);
}

// The invite body moved from isPrimaryContact to isNextOfKin and the relationship list changed.
const invite = (adminFolder.item.find((i) => i.name === "Family Invitations") || { item: [] }).item.find(
  (r) => r.name === "invite family member"
);
if (invite && invite.request.body) {
  const body = JSON.parse(invite.request.body.raw);
  delete body.isPrimaryContact;
  body.relationship = "daughter";
  body.isNextOfKin = false;
  invite.request.body.raw = JSON.stringify(body, null, 2);
  invite.request.description = (invite.request.description || "").replace(
    /relationship is one of [^.]*\./,
    "relationship is one of spouse, partner, son, daughter, grandson, granddaughter, brother, sister, nephew, niece, friend, legalGuardian, other. isNextOfKin makes the person the resident's next of kin; the previous next of kin steps down."
  );
}

const vars = collection.variable || [];
for (const key of ["familyCode", "joinRequestId", "memberId", "handoverId"]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value: "", type: "string" });
  }
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman family access updated");
