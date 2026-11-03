const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const appFolder = collection.item.find((i) => i.name === "App");
if (!appFolder) throw new Error("App folder not found");
const adminFolder = collection.item.find((i) => i.name === "Admin Panel");
if (!adminFolder) throw new Error("Admin Panel folder not found");

const test = (lines) => ({
  listen: "test",
  script: { type: "text/javascript", exec: lines },
});

/**
 * Optional filters, listed on the Params tab switched off with a note on each: tick one to use it. They are not
 * part of the URL until ticked, so a request still sends only what it needs.
 */
const optionalParams = (optional = {}) =>
  Object.entries(optional).map(([key, [value, description]]) => ({ key, value, description, disabled: true }));

const req = (name, method, pathParts, { query, optional, tests, description, header } = {}) => ({
  name,
  event: tests ? [test(tests)] : [],
  request: {
    method,
    header: header || [],
    url: {
      raw: `{{url}}/${pathParts.join("/")}${query ? `?${query}` : ""}`,
      host: ["{{url}}"],
      path: pathParts,
      // Postman reads the Params tab from this list, not from the raw string.
      ...(query || optional
        ? {
            query: [
              ...(query
                ? query.split("&").map((pair) => {
                    const [key, ...rest] = pair.split("=");
                    return { key, value: rest.join("=") };
                  })
                : []),
              ...optionalParams(optional),
            ],
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

// ---------------------------------------------------------------- Uploads (family app)
requests.push(
  {
    name: "upload photo",
    event: [
      test([
        'pm.test("Photo uploaded", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data).to.have.keys(["mediaId", "url", "width", "height"]);',
        '    pm.collectionVariables.set("mediaId", data.mediaId);',
        "});",
      ]),
    ],
    request: {
      method: "POST",
      header: [],
      body: { mode: "formdata", formdata: [{ key: "file", type: "file", src: [] }] },
      url: { raw: "{{url}}/app/family/media", host: ["{{url}}"], path: ["app", "family", "media"] },
      description:
        "New Upload: Upload Photos. Body is form-data with one image in the field file (choose a file in Postman). Images only, up to 10 MB; the server checks it is a real image, resizes it to 2048px and stores it. Sets mediaId for send upload for approval. One photo per call.",
    },
    response: [],
  },
  {
    name: "upload photos",
    event: [
      test([
        'pm.test("Photos uploaded", function () {',
        "    pm.response.to.have.status(201);",
        "    const photos = pm.response.json().data.photos;",
        '    pm.expect(photos).to.be.an("array").that.is.not.empty;',
        '    pm.collectionVariables.set("mediaId", photos[0].mediaId);',
        '    pm.collectionVariables.set("mediaIds", JSON.stringify(photos.map((p) => p.mediaId)));',
        "});",
      ]),
    ],
    request: {
      method: "POST",
      header: [],
      body: { mode: "formdata", formdata: [{ key: "files", type: "file", src: [] }] },
      url: { raw: "{{url}}/app/family/media/batch", host: ["{{url}}"], path: ["app", "family", "media", "batch"] },
      description:
        "New Upload: Upload Photos, several at once. Form-data field files; select up to 10 images in that one row (10 MB each, 50 MB together). Every file is checked before any is stored, so one bad file stores nothing and the error names it. Returns photos, a list of mediaId in the order sent. Sets mediaId (the first) and mediaIds (all, as a JSON list): in send upload for approval replace [\"{{mediaId}}\"] with {{mediaIds}} to attach them all.",
    },
    response: [],
  },
  withBody(
    req("send upload for approval", "POST", ["app", "family", "uploads"], {
      tests: [
        'pm.test("Upload sent for approval", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.status).to.eql("pending");',
        '    pm.collectionVariables.set("uploadId", data.uploadId);',
        "});",
      ],
      description:
        "New Upload: Send For Approval. Body: residentId, message (up to 500 characters), mediaIds (up to 10, from upload photo), includeInGazette, clientId. Needs a message or a photo. 400 photos_cannot_be_shared when the resident has photo sharing off (a message alone is allowed); 400 for too many photos, a message over 500 characters or photos that are not yours; 404 for a resident you are not linked to. The same clientId returns the upload already made. Saved as pending; nobody but you sees it until a manager approves.",
    }),
    {
      residentId: "{{residentId}}",
      message: "Lily scored twice at her first football match!",
      mediaIds: ["{{mediaId}}"],
      includeInGazette: true,
      clientId: "postman-upload-1",
    }
  ),
  req("next gazette", "GET", ["app", "family", "gazettes", "next"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Next gazette fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.include.keys("scheduled");',
      "});",
    ],
    description:
      "The Gazette tab's top card: the gazette being collected now. Query: residentId (required). scheduled is false until the organization has saved a gazette schedule (then issue is null and there is nothing to show). Otherwise issue has number (No. 15), state (collecting, or notStarted before the first issue begins), periodStart, periodEnd, periodLabel (15 Oct – 28 Oct 2026) and closesAt (the Closes 28 Oct pill). messageCap is 30, messagesUsed is the 9 in '9 of 30 messages' (approved messages meant for the gazette; at most the cap), messagesSent is how many were sent in all, remaining, overflow (sent beyond the cap, which wait for the next gazette), isFull (the Gazette full screen) and percentFull for the progress bar. A message printed in an earlier gazette, or taken out by staff, does not count again.",
  }),
  req("printed gazettes", "GET", ["app", "family", "gazettes"], {
    query: "residentId={{residentId}}&page=1&limit=10",
    tests: [
      'pm.test("Printed gazettes fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.be.an("array");',
      '    if (data.length) pm.collectionVariables.set("gazetteId", data[0].gazetteId);',
      "});",
    ],
    description:
      "Printed gazettes: the gazettes the home has printed for the resident, newest first. Query: residentId (required), page, limit. Each row has gazetteId, title (The Hughes Family Gazette), issueNumber (Gazette no. 14), periodLabel (1 Oct – 14 Oct 2026), messageCount, pageCount (the 6 pages), printedAt and givenAt (the 'Printed 15 Oct · given 15 Oct' line, with givenAt empty until the home records it) and latest, true on the newest one overall (the Latest pill and the card on the Gazette tab). Only printed gazettes are listed.",
  }),
  req("read gazette", "GET", ["app", "family", "gazettes", "{{gazetteId}}"], {
    tests: [
      'pm.test("Gazette fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.include.keys("gazetteId", "title", "messages", "life");',
      "});",
    ],
    description:
      "Read gazette: the printed gazette for the reader. gazetteId comes from printed gazettes. title, issueNumber, periodLabel (No. 14 · 1–14 Oct 2026), residentName (for Margaret), homeName, pageCount, printedAt and givenAt. cover is the best photo of the issue (the newest photo) with its message, headline, authorName and relationshipLabel, or null when there is no photo. messages are the family's messages oldest first: authorName, relationshipLabel (Daughter), message, photos and sentAt. life is Life at the home: title, text, photoUrl and postedAt. Photos are the blurred copy wherever one exists. Anything no longer allowed is left out on every read: a resident whose photo sharing is off has no photos, and a wall post that was removed is gone. 404 gazette_not_found for a gazette that is not printed, belongs to another resident, or is not yours.",
  }),
  req("download gazette pdf", "GET", ["app", "family", "gazettes", "{{gazetteId}}", "pdf"], {
    optional: { format: ["url", "url returns a signed link to the stored PDF (valid 5 minutes) as { url, expiresAt, filename } instead of the file; a PDF that is drawn on demand is still returned as the file"] },
    query: "download=true",
    tests: [
      'pm.test("PDF returned", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf");',
      "});",
    ],
    description:
      "The PDF of a printed gazette, the copy the home printed (drawn again from the saved content if the file was lost). download=false opens it inline; otherwise it is an attachment. Same visibility rules as read gazette. Rate limited. In Postman use Send and Download to save it.",
  }),
  req("my uploads", "GET", ["app", "family", "uploads"], {
    query: "page=1&limit=10",
    optional: {
      status: ["pending", "Tab: pending, approved or rejected"],
      residentId: ["{{residentId}}", "One resident"],
    },
    tests: [
      'pm.test("My uploads fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("pending", "approved", "rejected");',
      "});",
    ],
    description:
      "My Uploads: Approved, Waiting For Approval and Not Approved (with rejectionReason). Optional query: status (pending, approved, rejected), residentId, page, limit. meta.counts has the three totals and ignores the status filter. Photos show the blurred copy once one exists. Rejected uploads disappear 30 days after rejection.",
  }),
  withBody(
    req("edit and resend upload", "PUT", ["app", "family", "uploads", "{{uploadId}}"], {
      tests: [
        'pm.test("Upload resent", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("pending");',
        "});",
      ],
      description:
        "My Uploads: Edit And Resend. Body (all optional): message, mediaIds, includeInGazette. A pending or not approved upload returns to pending with the reason cleared. 409 upload_not_editable once approved; 404 for someone else's upload or after you were removed from the family.",
    }),
    { message: "Lily scored twice at her first football match, Gran!", includeInGazette: true }
  ),
  req("delete my upload", "DELETE", ["app", "family", "uploads", "{{uploadId}}"], {
    tests: [
      'pm.test("Upload deleted", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.have.property("uploadId");',
      "});",
    ],
    description:
      "My Uploads: delete my own upload. Only a pending or not approved upload can be deleted; an approved one is already shared with the family and is final (409 upload_not_deletable). Its photos are deleted with it, including the files in storage, and so are the notifications about it, so the managers' New upload to review disappears. 404 upload_not_found for an upload that is not mine, for a resident I am no longer linked to, or one that is already gone. Returns uploadId. Family token.",
  })
);

// ---------------------------------------------------------------- Resident timeline
requests.push(
  req("timeline", "GET", ["app", "family", "timeline"], {
    query: "residentId={{residentId}}&page=1&limit=20",
    tests: [
      'pm.test("Timeline fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta).to.have.property("totalRecords");',
      "});",
    ],
    description:
      "Home Family Tab, Family: everything shared about the resident, newest first. Query: residentId (required), page, limit (default 20, max 50). Approved uploads from any family member only; pending and rejected ones never appear. Each item has type, authorName, authorPhotoUrl, authorRelationship, message, photos (the blurred copy where one exists) and publishedAt (when it was approved). 404 if you are not linked to the resident or the module is off.",
  })
);

// ---------------------------------------------------------------- Gallery
requests.push(
  req("gallery", "GET", ["app", "family", "gallery"], {
    query: "residentId={{residentId}}&tab=all&page=1&limit=30",
    tests: [
      'pm.test("Gallery fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("all", "thisMonth", "fromMe");',
      "});",
    ],
    description:
      "The Gallery screen. Query: residentId (required), tab (all, thisMonth or fromMe: the tabs All, This Month and From Me; 400 invalid_gallery_tab for anything else), page, limit (default 30, max 60). One tile per photo, newest first: mediaId, url (the blurred copy where the home made one), width, height, source (upload or wallPost), uploadId or postId, takenAt, fromMe. The photos are the approved family uploads for the resident plus the published wall posts that tag them; pending and rejected uploads never appear. meta.counts has the three tab totals and meta.photoSharing is false, with no photos at all, when the resident has photo sharing switched off: it is checked on every request, so the photos leave at once.",
  })
);

// ---------------------------------------------------------------- Home (family app)
requests.push(
  req("home", "GET", ["app", "family", "home"], {
    optional: { residentId: ["{{residentId}}", "The resident being viewed; the first one when left out"] },
    tests: [
      'pm.test("Home fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("greeting", "homeName", "resident", "residents", "nextVisit", "visiting", "gazette", "notices", "unread");',
      '    pm.expect(data.notices).to.be.an("array");',
      "});",
    ],
    description:
      "The Home Family tab in one call. Optional query: residentId (the resident being viewed; the first one when left out; 400 invalid_resident_id, 404 resident_not_found for one that is not mine). Returns greeting (Good morning, Sarah: by the time of day at the resident's home), homeName, resident (the one shown), residents (the header dropdown, with isActive), nextVisit (the Your Next Visit card, null when there is none), visiting {paused, reason, since}, gazette (the Gazette Due card: scheduled, issue, remaining), notices (banners: visitingPaused when the home has paused visiting; joinRequests, with a count, for a next of kin who has requests to review) and unread {notifications, messages} for the badges. The pieces are the same as resident, visits/next and gazettes/next, so the app can still call those on their own. Family token.",
  })
);

// ---------------------------------------------------------------- Visits (family app)
requests.push(
  req("my visits", "GET", ["app", "family", "visits"], {
    query: "residentId={{residentId}}&tab=upcoming&page=1&limit=20",
    tests: [
      'pm.test("Visits fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("upcoming", "past");',
      '    pm.expect(json.meta.visiting).to.have.all.keys("paused", "reason", "since");',
      '    if (json.data.length) { pm.collectionVariables.set("visitId", json.data[0].id); }',
      "});",
    ],
    description:
      "My Visits. Query: residentId (required), tab (upcoming or past; 400 invalid_visit_tab for anything else), page, limit (default 20, max 50). Upcoming is soonest first, past is newest first and includes declined and cancelled ones. A row is either my own request or an invitation From The Home (fromTheHome true): id, source (family or home), status (requested, confirmed, declined, cancelled; for an invitation invited until I answer, then going or cantMakeIt), startAt, endAt, partySize, note, decisionNote (the home's reply to a request), canCancel (my request, not yet over), canReply (an invitation I can still answer) and hasPass (Visit Pass available). meta.counts has the two tab totals; meta.visiting.paused, reason and since drive the Visiting is paused notice. A request is only visible to the person who made it; invitations from the home are visible to the whole family of the resident.",
  }),
  req("next visit", "GET", ["app", "family", "visits", "next"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Next visit fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.have.all.keys("visit", "visiting");',
      "});",
    ],
    description:
      "Home Family Tab, Your Next Visit: the soonest visit that is confirmed, or an invitation I said I would attend. visit is null when there is none. visiting is the same paused notice as My Visits.",
  }),
  req("visit options", "GET", ["app", "family", "visits", "options"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Visit options fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("days", "visitingHours", "maxPartySize", "visiting");',
      "    if (data.days.length) {",
      '        pm.collectionVariables.set("visitDate", data.days[Math.min(1, data.days.length - 1)].date);',
      '        pm.collectionVariables.set("visitTime", data.visitingHours.start);',
      "    }",
      "});",
    ],
    description:
      "Book A Visit: what the home offers. days (the next few days, date and weekday; today is left out once no time remains), visitingHours {start, end}, protectedTimes [{start, end, label}], maxPartySize, timezone and the visiting notice. The app builds the time to pick itself, from the visiting hours, a start every half hour; the server checks the time it sends. The home sets these per site; until it does, the defaults are visiting hours of 12:00 to 18:00, 14 days ahead and up to 6 people. Sets visitDate and visitTime (the opening time) for the request below.",
  }),
  withBody(
    req("request a visit", "POST", ["app", "family", "visits"], {
      tests: [
        'pm.test("Visit requested", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.status).to.eql("requested");',
        '    pm.collectionVariables.set("visitId", data.id);',
        "});",
      ],
      description:
        "Book A Visit, the Request button. Body: residentId, date (YYYY-MM-DD from visit options), time (HH:mm on the half hour, inside the visiting hours with at least half an hour before closing, and not in a protected time), totalPeople (1 to maxPartySize) and an optional note (up to 500 characters). The visit runs from that time until the visiting hours end. It is a request until the home confirms it. Errors: 403 visiting_paused, 400 invalid_visit_time for a time that isn't offered, 400 visit_protected_time for a closed time, 400 for a date or number that isn't offered or a day that has passed, 409 visit_already_requested for the same time, 429 once five requests are waiting.",
    }),
    {
      residentId: "{{residentId}}",
      date: "{{visitDate}}",
      time: "{{visitTime}}",
      totalPeople: 2,
      note: "Birthday tea",
    }
  ),
  withBody(
    req("cancel my visit", "PUT", ["app", "family", "visits", "{{visitId}}"], {
      tests: [
        'pm.test("Visit cancelled", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("cancelled");',
        "});",
      ],
      description:
        "PUT with body {\"action\":\"cancel\"}. My Visits, Cancel Request: cancels my own request while it is waiting or confirmed and not over; a confirmed visit also stops its kiosk code working. 409 visit_not_cancellable otherwise, 404 for anyone else's visit.",
    }),
    { action: "cancel" }
  ),
  withBody(
    req("reply to visit invitation", "PUT", ["app", "family", "visits", "{{visitId}}"], {
      tests: [
        'pm.test("Answer saved", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(["going", "cantMakeIt"]).to.include(pm.response.json().data.status);',
        "});",
      ],
      description:
        "PUT with body {\"action\":\"going\"} (I'll Be There) or {\"action\":\"cantMakeIt\"} (Can't Make It). Answers an invitation From The Home for myself only; each family member answers separately and may change their mind until the visit is over. Going gives me my own kiosk code for the Visit Pass; Can't Make It withdraws it. 409 visit_not_replyable once the visit is over or cancelled, 404 for a request or another family's visit.",
    }),
    { action: "going" }
  ),
  req("visit pass", "GET", ["app", "family", "visit-pass"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Visit pass fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("visit", "code", "guests", "carRegistration", "visiting");',
      "});",
    ],
    description:
      "Visit Pass. visit is my next confirmed visit (or an invitation I said I would attend) and code is its kiosk code, the same 6-digit invitation code the kiosk already accepts: show it as the QR code. Both are null when there is no such visit. guests are the people without the app and carRegistration the car, as saved below. The code does not refresh by itself yet: a code that changes every few seconds needs the kiosk to check it.",
  }),
  withBody(
    req("update visit pass", "PUT", ["app", "family", "visit-pass"], {
      tests: [
        'pm.test("Visit pass saved", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.guests).to.be.an("array");',
        "});",
      ],
      description:
        "Saves the guests without the app and the car registration for this resident. Body: residentId, guests (up to 10 names, each up to 60 characters), carRegistration (up to 12 letters, digits, spaces or hyphens; send an empty string to clear it). Anything left out stays as it was. Returns the pass.",
    }),
    { residentId: "{{residentId}}", guests: ["Tom Hughes"], carRegistration: "AB12 CDE" }
  )
);

// ---------------------------------------------------------------- Community wall (family app)
requests.push(
  req("newsletters of my home", "GET", ["app", "family", "newsletters"], {
    query: "residentId={{residentId}}&page=1&limit=10",
    tests: [
      'pm.test("Newsletters fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.be.an("array");',
      "});",
    ],
    description:
      "Newsletters (menu): current and past issues of the resident's home, newest sent first. Query: residentId (required, it picks the home), page, limit. Only newsletters that were sent into the app are listed; drafts, scheduled ones and ones sent only by email are not. Each row has newsletterId, title, homeName, month, periodLabel (October 2026), issueNumber, sentAt, editedAt and a short summary from the welcome note.",
  }),
  req("read newsletter", "GET", ["app", "family", "newsletters", "{{newsletterId}}"], {
    tests: [
      'pm.test("Newsletter fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("newsletterId", "title", "periodLabel", "highlights", "comingUp", "notices", "gallery");',
      "});",
    ],
    description:
      "Newsletter screen: the whole issue for reading: title, homeName, periodLabel, issueNumber, sentAt, editedAt (the 'edited 1 Oct' line), the welcome note with signature, highlights (title, text, photoUrl, postedAt), coming up (date, time, title, description, category), notices, new residents, gallery and the footer. Only the sections the home switched on are returned. Posts removed, and residents whose photo sharing is now off, are left out on every read (BR-06). 404 newsletter_not_found for a draft, a scheduled one, one not sent into the app, or another home's. Send the family token; any of your linked homes works.",
  }),
  req("download newsletter pdf", "GET", ["app", "family", "newsletters", "{{newsletterId}}", "pdf"], {
    optional: { format: ["url", "url returns a signed link to the stored PDF (valid 5 minutes) as { url, expiresAt, filename } instead of the file; a PDF that is drawn on demand is still returned as the file"] },
    query: "download=true",
    tests: [
      'pm.test("PDF returned", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf");',
      "});",
    ],
    description:
      "The PDF button on the Newsletter screen: the same A4 PDF the home emails (the copy stored when it was sent, or drawn from what was sent when none was stored). download=false opens it inline; otherwise it is an attachment. Same visibility rules as read newsletter. Rate limited. In Postman use Send and Download to save it.",
  }),
  req("community wall", "GET", ["app", "family", "wall"], {
    query: "residentId={{residentId}}&page=1&limit=10",
    tests: [
      'pm.test("Wall fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.be.an("array");',
      "});",
    ],
    description:
      "Home Family Tab, Community Wall: the home's published posts, pinned first then newest. Query: residentId (required, it picks the home), page, limit. Each post has homeName, authorName, message, photos, isPinned, reactionCount, reactedByMe and taggedResidents (only residents you are linked to). Sets postId from the first post for the reaction requests.",
  }),
  req("react to post", "PUT", ["app", "family", "wall", "{{postId}}", "reaction"], {
    tests: [
      'pm.test("Reaction saved", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.reactedByMe).to.eql(true);',
      "});",
    ],
    description:
      "One tap. One reaction per member per post, so sending it again changes nothing. Returns reactionCount and reactedByMe. 404 for a removed post or a post at a home you are not linked to.",
  }),
  req("remove reaction", "DELETE", ["app", "family", "wall", "{{postId}}", "reaction"], {
    tests: [
      'pm.test("Reaction removed", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.reactedByMe).to.eql(false);',
      "});",
    ],
    description: "Removes your reaction; safe to send twice. Returns reactionCount and reactedByMe.",
  })
);
// the wall request remembers a post for the reaction requests
requests.find((r) => r.name === "community wall").event.push(
  test([
    "const posts = pm.response.json().data;",
    'if (posts.length) { pm.collectionVariables.set("postId", posts[0].postId); }',
  ])
);

// ---------------------------------------------------------------- Community wall: seen and reports (family app)
requests.push(
  withBody(
    req("mark posts seen", "PUT", ["app", "family", "wall", "seen"], {
      tests: [
        'pm.test("Posts marked seen", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data).to.have.property("seen");',
        "});",
      ],
      description:
        "Send the ids of the wall posts that were shown on screen (up to 50). Only posts you may see count, and sending one twice changes nothing. Staff see it as Seen 31/42 on each post.",
    }),
    { postIds: ["{{postId}}"] }
  ),
  withBody(
    req("report post", "POST", ["app", "family", "wall", "{{postId}}", "report"], {
      tests: [
        'pm.test("Post reported", function () {',
        "    pm.response.to.have.status(201);",
        '    pm.expect(pm.response.json().data.reported).to.eql(true);',
        "});",
      ],
      description:
        "Report a post (post menu: Report). Body: reason (optional, up to 500 characters). Reporting twice is the same as once, the poster is never told who reported, and staff see it under Needs your attention. 404 for a removed post or one at a home you are not linked to.",
    }),
    { reason: "Wrong photo for this resident" }
  )
);

// ---------------------------------------------------------------- Invite Family (by email)
requests.push(
  req("invitations I sent", "GET", ["app", "family", "member-invitations"], {
    query: "residentId={{residentId}}",
    tests: [
      'pm.test("Sent invitations fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    pm.expect(pm.response.json().data).to.be.an(\"array\");",
      "});",
    ],
    description:
      "Invitations this next of kin sent for the resident, newest first, with status (pending, accepted, revoked, expired). Optional query: status, page, limit. Next of kin only.",
  }),
  withBody(
    req("invite a relative", "POST", ["app", "family", "member-invitations"], {
      tests: [
        'pm.test("Invitation sent", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.status).to.eql("pending");',
        '    pm.expect(data).to.not.have.any.keys("token", "tokenHash");',
        '    if (data.acceptUrl) { pm.collectionVariables.set("familyInviteToken", data.acceptUrl.split("/").pop()); }',
        "});",
      ],
      description:
        "Invite Family: the next of kin invites a relative. Body: residentId, name, email, relationship (a value from relationship options). The invitee gets an email with a one-time link valid for 7 days. With EMAIL_ENABLED on the sender never receives the link. While it is off, nothing is delivered, so the response also includes acceptUrl and this request saves its token in familyInviteToken for accept family invitation. Next of kin only (403 otherwise); 400 for a missing name or bad relationship or email; 409 if the email belongs to a staff member, is already a member, or already has a pending invitation. Figma screen: Invite Family (Send Invite).",
    }),
    { residentId: "{{residentId}}", name: "Jane Doe", email: "{{relativeEmail}}", relationship: "granddaughter" }
  )
);

// ---------------------------------------------------------------- Staff side (Admin Panel > Family Management)
const orgHeader = [
  {
    key: "x-org-id",
    value: "{{organizationId}}",
    description: "Organization scope for admin routes.",
    type: "text",
  },
];
const STAFF_ACCESS =
  " Needs the Family Engagement module (404 when it is off) and the matching permission: familyEngagement.view to read, .manage to change, .approve to decide join requests. Owners and super admins always have them; a site or line manager needs them granted.";
const staff = (name, method, pathParts, options = {}) =>
  req(name, method, pathParts, {
    ...options,
    header: orgHeader,
    description: (options.description || "") + STAFF_ACCESS,
  });

const staffRequests = [
  {
    name: "upload post photos",
    event: [
      test([
        'pm.test("Photos uploaded", function () {',
        "    pm.response.to.have.status(201);",
        "    const photos = pm.response.json().data.photos;",
        '    pm.expect(photos).to.be.an("array").that.is.not.empty;',
        '    pm.collectionVariables.set("mediaId", photos[0].mediaId);',
        '    pm.collectionVariables.set("mediaIds", JSON.stringify(photos.map((p) => p.mediaId)));',
        "});",
      ]),
    ],
    request: {
      method: "POST",
      header: orgHeader,
      body: { mode: "formdata", formdata: [{ key: "files", type: "file", src: [] }] },
      url: { raw: "{{url}}/admin/family/posts/media/batch", host: ["{{url}}"], path: ["admin", "family", "posts", "media", "batch"] },
      description:
        "Several photos for a wall post. Form-data field files; select up to 10 images in that one row. Returns photos with their mediaIds. Sets mediaId (the first) and mediaIds (all, as a JSON list): in create post replace [\"{{mediaId}}\"] with {{mediaIds}}. Needs familyEngagement.manage.",
    },
    response: [],
  },
  req("newsletters", "GET", ["admin", "organizations", "{{organizationId}}", "family-newsletters"], {
    query: "page=1&limit=10",
    optional: {
      status: ["draft", "Tab: draft, scheduled, sending or sent"],
      branchId: ["{{branchId}}", "One site"],
      month: ["2026-10", "One month"],
      keyword: ["october", "Search the title"],
    },
    tests: [
      'pm.test("Newsletters fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("draft", "scheduled", "sending", "sent");',
      "});",
    ],
    description:
      "Newsletters page: every newsletter of the organization, newest month first. Optional query: status, branchId, month (2026-10), keyword (title), page, limit. meta.counts has draft, scheduled, sending and sent and ignores the status filter. Needs familyEngagement.view; 404 when the module is off.",
  }),
  req("newsletter detail", "GET", ["admin", "organizations", "{{organizationId}}", "family-newsletters", "{{newsletterId}}"], {
    tests: [
      'pm.test("Newsletter fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("newsletterId", "title", "sections", "highlights", "recipients");',
      "});",
    ],
    description:
      "Content Sections and Preview: title, month, issue number, status, the six sections with their switches, welcome, highlights with photos, coming up, notices, new residents, gallery, footer, and recipients (families and people who would receive it). Needs familyEngagement.view.",
  }),
  req("newsletter pdf", "GET", ["admin", "organizations", "{{organizationId}}", "family-newsletters", "{{newsletterId}}", "pdf"], {
    optional: { format: ["url", "url returns a signed link to the stored PDF (valid 5 minutes) as { url, expiresAt, filename } instead of the file; a PDF that is drawn on demand is still returned as the file"] },
    query: "download=false",
    tests: [
      'pm.test("PDF returned", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf");',
      "});",
    ],
    description:
      "The Preview and the Download PDF button. Returns the newsletter as an A4 PDF drawn like the home's template: header, welcome, the month's posts with photos, coming up and notices side by side, new residents, photo gallery and footer. Only the sections that are switched on are drawn. A draft is drawn fresh, leaving out posts removed and residents whose photo sharing is off since it was built; a sent newsletter serves the copy stored when it was sent (when the PDF channel was on). Query download=true sends it as an attachment, otherwise it opens inline. In Postman use Send and Download to save it. Needs familyEngagement.view.",
  }),
  req("family relationship options", "GET", ["admin", "family", "relationships"], {
    tests: [
      'pm.test("Relationship options fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.be.an("array");',
      '    pm.expect(data[0]).to.have.keys(["value", "label"]);',
      "});",
    ],
    description:
      "Options for the Relationship dropdowns on the web panel: Invite Family Member, Manage Family Group and editing a member or invitation (Spouse, Partner, Son, Daughter, Grandson, Granddaughter, Brother, Sister, Nephew, Niece, Friend, Legal guardian, Other). Send the value (such as granddaughter) in relationship. A fixed list, so any signed-in user can call it: no x-org-id header, module or permission is needed.",
  }),
  req("gazettes", "GET", ["admin", "organizations", "{{organizationId}}", "family-gazettes"], {
    query: "page=1&limit=10",
    optional: {
      status: ["ready", "Tab: ready, notReady, failed, printed or building (all by default)"],
      branchId: ["{{branchId}}", "One site (the page shows each site's current issue)"],
      keyword: ["margaret", "Search resident, room or status"],
    },
    tests: [
      'pm.test("Gazettes fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const body = pm.response.json();",
      '    pm.expect(body.data).to.be.an("array");',
      '    pm.expect(body.meta.counts).to.include.keys("total", "ready", "notReady", "failed", "printed", "building", "overCap");',
      '    if (body.data.length) { pm.collectionVariables.set("gazetteItemId", body.data[0].itemId); }',
      "});",
    ],
    description:
      "The Gazettes page: one row per resident for the issue each site is on now. Optional query: branchId (one site), status (the tab: all, ready, notReady, failed, printed or building; anything else is 400 invalid_status_filter), keyword (resident, room or status), page, limit. Each row has itemId, residentName, photoUrl, roomNumber, familyCount (Family column), messageCount (Messages column; it can be over the cap, like 31), status (ready, notReady, failed, printed or building), reason (noContent or noFamily when the status is notReady, otherwise empty) and statusLabel (Ready, Over 30 messages, No content, No family linked, Printed, Failed or Building), hasPdf, generatedAt, printedAt and givenAt. meta.counts feeds the cards and tabs: total (Residents in this issue), ready (Ready to print, including ones over the cap), notReady (no content or no family linked), failed, printed, building and overCap (how many ready ones are over the cap); it ignores the tab chosen. The page shows nothing about the issue itself, so none is returned; the Over 30 messages label already carries the cap. Needs familyEngagement.view.",
  }),
  req("gazette detail", "GET", ["admin", "organizations", "{{organizationId}}", "family-gazettes", "{{gazetteItemId}}"], {
    tests: [
      'pm.test("Gazette fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.include.keys("itemId", "resident", "state", "messages", "life");',
      "});",
    ],
    description:
      "One resident's gazette to check and fix: the issue, the resident, status, reason, statusLabel, familyCount, messageCount, includedCount, overCap, hasPdf and the print dates. messages lists every message sent for it with uploadId, authorName, relationshipLabel, message, photos (the blurred copy, which is what is printed), sentAt and placement: included, movedToNext (over the cap, waiting for the next issue) or removed (taken out by staff). life lists the wall posts for Life at the home. Needs familyEngagement.view.",
  }),
  req("gazette pdf", "GET", ["admin", "organizations", "{{organizationId}}", "family-gazettes", "{{gazetteItemId}}", "pdf"], {
    optional: { format: ["url", "url returns a signed link to the stored PDF (valid 5 minutes) as { url, expiresAt, filename } instead of the file; a PDF that is drawn on demand is still returned as the file"] },
    query: "download=false",
    tests: [
      'pm.test("PDF returned", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf");',
      "});",
    ],
    description:
      "The eye icon (preview) and the download: the resident's gazette as an A4 PDF, the stored copy when there is one, otherwise drawn from the saved content. download=true sends it as an attachment, otherwise it opens inline. 409 gazette_nothing_to_show for a resident with no messages or no family. In Postman use Send and Download to save it. Needs familyEngagement.view.",
  }),
  req("download all gazette pdfs", "GET", ["admin", "organizations", "{{organizationId}}", "family-gazettes", "download"], {
    tests: [
      'pm.test("Zip returned", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/zip");',
      "});",
    ],
    description:
      "The Download all PDFs button: a zip of every drawn gazette (ready or printed) of the issue each site is on, one PDF per resident named like margaret-hughes-gazette-issue-14.pdf; with several sites each has a folder. Optional query: branchId. 404 gazette_nothing_to_download when nothing has been drawn yet, 400 for more than 100 gazettes (choose a site). Rate limited. Needs familyEngagement.view.",
  }),
  req("family overview", "GET", ["admin", "organizations", "{{organizationId}}", "family-overview"], {
    optional: {
      branchId: ["{{branchId}}", "One site; a site or line manager always gets their own"],
      days: ["7", "Family activity window, 1 to 365 (default 7)"],
    },
    tests: [
      'pm.test("Family overview fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.have.all.keys("site", "stats", "gazette", "activity", "checklist");',
      '    pm.expect(data.checklist).to.have.lengthOf(4);',
      "});",
    ],
    description:
      "The Family overview screen of owners, site managers and line managers, in one call. site is the home shown under the title (null when an owner looks at every site). stats are the four cards: uploadsPending, reportedPosts, residentsWithFamily and residentsWithNoContent. gazette is the Issue card: number, closesAt, closesInDays and state (collecting or notStarted), or scheduled false when gazettes are not set up. activity is Family activity: uploads (total, approved, pending, notApproved), wallPosts, reactions over the last days, and nextNewsletter (title, status, dueAt, homeName; null when none is open). checklist is Checklist before the issue closes, in order: moderation, noContent, generate, printAndGive, each with count and done. The Go to moderation and New wall post buttons use the moderation and wall endpoints. Optional query: branchId, days. A site or line manager is always held to their own site. Needs familyEngagement.view; 404 when the module is off.",
  }),
  req("post authors", "GET", ["admin", "organizations", "{{organizationId}}", "family-post-authors"], {
    optional: {
      branchId: ["{{branchId}}", "One site"],
      keyword: ["claire", "Search the author's name"],
    },
    tests: [
      'pm.test("Post authors fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.be.an("array");',
      '    if (data.length) { pm.collectionVariables.set("authorId", data[0].authorId); }',
      "});",
    ],
    description:
      "The Author filter list on the Community Wall: everyone who has posted in the organization, one row per person with authorId, name, photoUrl, role (such as Site Manager) and postsCount, sorted by name. Optional query: branchId (only people who posted at that site) and keyword (part of the name). Send the chosen authorId as authorId in wall posts. Sets authorId. Needs familyEngagement.view; 404 when the module is off.",
  }),
  req("wall posts", "GET", ["admin", "organizations", "{{organizationId}}", "family-posts"], {
    query: "page=1&limit=10",
    optional: {
      status: ["published", "Tab: published (default), draft, scheduled or removed"],
      branchId: ["{{branchId}}", "One site"],
      residentId: ["{{residentId}}", "Resident filter: posts tagged to this resident"],
      authorId: ["{{authorId}}", "Author filter"],
      audience: ["all", "Group filter: all, branch or tagged"],
      days: ["30", "Last 30 days: 1 to 365. Cannot be used with from and to"],
      from: ["2026-10-01", "Posts from this day (not with days)"],
      to: ["2026-10-31", "Posts up to this day (not with days)"],
      pinned: ["true", "Pin tab: only pinned posts"],
      hasPhotos: ["true", "Photos tab: only posts with photos"],
      reported: ["true", "Only posts with an open report"],
      sort: ["newest", "Newest first (default) or oldest"],
      keyword: ["garden", "Search post, tagged resident or author"],
    },
    tests: [
      'pm.test("Wall posts fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("published", "removed");',
      "});",
    ],
    description:
      "Staff Community Wall: every post of the organization, pinned first then newest. Optional query: status (published, draft, scheduled or removed), branchId, residentId (the Resident filter: tagged), authorId (the Author filter), audience (the Group filter: all, branch or tagged), days (Last 30 days: 1 to 365; it cannot be combined with from and to; it also sets the window of meta.activity), pinned=true, hasPhotos=true, from and to (2026-10-01), sort (newest or oldest), keyword (post text, tagged resident or author), page, limit. Each post has the author (name, photo, role), the home, photos, tagged residents with their photos, isPinned and reactionCount. meta.counts has published, draft, scheduled, removed, pinned and photos for the tabs (scheduled posts are listed soonest first, drafts by last edit). Each post has audience (all, branch or tagged) and audienceLabel (All families & residents, Florence House families or Tagged resident families), and audienceCount is how many families it is for (the 42 in Seen 31/42). The same response carries the rest of the screen: meta.gazette is the 'Gazette no. 14 closes in 3 days' card (pass branchId for one site; without it the card covers every site that is not suspended: the resident counts are added up, the earliest close is shown, number is the highest next number and sites says how many sites it covers): scheduled (false until a gazette schedule is saved), number, state, periodLabel, closesAt, closesInDays, messageCap, residents {total, withContent, noContent, noFamily, overCap} ('33 of 42 residents have content', '4 no content', '1 over 30') and percentWithContent for the progress bar; it is null only when the organization has no site that is not suspended, or the branchId is not one of its sites. Also meta.attention (the Needs your attention card: pendingUploads {count, oldestAt}, reportedPosts {count, reports, oldestAt}, total) and meta.activity (Staff activity: days and authors with posts, name, photo and role; query days 1 to 365, default 30). Each post also has seenCount, audienceCount, recentReactors (latest 3), reportCount and reports (its open reports, newest 5: reporterName, reason, createdAt); they ignore the status, pinned and photos filters but follow the others. Needs familyEngagement.view; 404 when the module is off.",
  }),
  staff("taggable residents", "GET", ["admin", "family", "posts", "taggable-residents"], {
    query: "branchId={{branchId}}",
    tests: [
      'pm.test("Taggable residents fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.be.an("array");',
      "});",
    ],
    description:
      "The tag picker: residents of the site that photo sharing is on for. A site or line manager always gets their own site; an owner or super admin can pass branchId (or none for every site).",
  }),
  {
    name: "upload post photo",
    event: [
      test([
        'pm.test("Photo uploaded", function () {',
        "    pm.response.to.have.status(201);",
        '    pm.collectionVariables.set("mediaId", pm.response.json().data.mediaId);',
        "});",
      ]),
    ],
    request: {
      method: "POST",
      header: orgHeader,
      body: { mode: "formdata", formdata: [{ key: "file", type: "file", src: [] }] },
      url: { raw: "{{url}}/admin/family/posts/media", host: ["{{url}}"], path: ["admin", "family", "posts", "media"] },
      description:
        "One photo for a wall post. Form-data field file (choose a file in Postman). Images only, up to 10 MB; resized and stored. Sets mediaId for create post. Needs familyEngagement.manage.",
    },
    response: [],
  },
  {
    name: "upload photo for approval",
    event: [
      test([
        'pm.test("Photo uploaded", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data).to.have.keys(["mediaId", "url", "width", "height"]);',
        '    pm.collectionVariables.set("mediaId", data.mediaId);',
        "});",
      ]),
    ],
    request: {
      method: "POST",
      header: orgHeader,
      body: { mode: "formdata", formdata: [{ key: "file", type: "file", src: [] }] },
      url: { raw: "{{url}}/admin/family/uploads/media", host: ["{{url}}"], path: ["admin", "family", "uploads", "media"] },
      description:
        "Staff side of New Upload: one photo. Form-data field file (choose a file in Postman). Images only, up to 10 MB; checked, resized and stored. Sets mediaId for send upload for approval. Nothing is shared until the upload is approved." + STAFF_ACCESS,
    },
    response: [],
  },
  {
    name: "upload photos for approval",
    event: [
      test([
        'pm.test("Photos uploaded", function () {',
        "    pm.response.to.have.status(201);",
        "    const photos = pm.response.json().data.photos;",
        '    pm.expect(photos).to.be.an("array").that.is.not.empty;',
        '    pm.collectionVariables.set("mediaId", photos[0].mediaId);',
        '    pm.collectionVariables.set("mediaIds", JSON.stringify(photos.map((p) => p.mediaId)));',
        "});",
      ]),
    ],
    request: {
      method: "POST",
      header: orgHeader,
      body: { mode: "formdata", formdata: [{ key: "files", type: "file", src: [] }] },
      url: { raw: "{{url}}/admin/family/uploads/media/batch", host: ["{{url}}"], path: ["admin", "family", "uploads", "media", "batch"] },
      description:
        "Staff side of New Upload: several photos at once. Form-data field files; select up to 10 images in that one row (10 MB each, 50 MB together). Every file is checked before any is stored. Returns photos with their mediaIds. Sets mediaId (the first) and mediaIds." + STAFF_ACCESS,
    },
    response: [],
  },
  withBody(
    staff("send upload for approval (staff)", "POST", ["admin", "family", "uploads"], {
      tests: [
        'pm.test("Upload sent for approval", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.status).to.eql("pending");',
        '    pm.collectionVariables.set("uploadId", data.uploadId);',
        "});",
      ],
      description:
        "A staff member sends a note or photos about a resident for approval, the same as a family member does; it waits in the upload queue until a manager approves or rejects it. Body: residentId, message (up to 500 characters), mediaIds (up to 10, from upload photo for approval), includeInGazette, clientId (stops a double tap creating two). Needs a message or a photo. An owner or super admin can send for any resident; a site manager, line manager or staff member only for a resident of their own site (403 outside_managed_branch). 404 resident_not_found. 400 photos_cannot_be_shared when the home has photo sharing off.",
    }),
    {
      residentId: "{{residentId}}",
      message: "Tea party in the garden room",
      mediaIds: ["{{mediaId}}"],
      includeInGazette: true,
      clientId: "postman-staff-upload-1",
    }
  ),
  req("upload queue", "GET", ["admin", "organizations", "{{organizationId}}", "family-uploads"], {
    query: "page=1&limit=10",
    optional: {
      status: ["pending", "Tab: all (default), pending, approved or rejected"],
      branchId: ["{{branchId}}", "One site"],
      residentId: ["{{residentId}}", "One resident"],
      keyword: ["margaret", "Search caption, resident, room or uploader"],
    },
    tests: [
      'pm.test("Upload queue fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("pending", "approved", "rejected");',
      "});",
    ],
    description:
      "Moderation queue: uploads families sent. Every status by default, newest first, so decided uploads stay visible; status=pending lists only the queue, oldest first. Optional query: status (all by default, or waiting, approved, rejected), branchId, residentId, keyword (caption, resident, room or uploader name or email), page, limit. Each row has the resident (name, room, photo), the uploader (name, email, photo and relationship to the resident such as daughter), the caption (message), the original photos, status and when it was sent. meta.counts has total, pending, approved and rejected for the tabs and ignores the status filter; meta.oldestPendingAt is when the oldest pending upload was sent. Needs familyEngagement.view; 404 when the module is off.",
  }),
  req("family member detail", "GET", ["admin", "organizations", "{{organizationId}}", "family-members", "{{memberId}}"], {
    tests: [
      'pm.test("Family member fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("memberId", "name", "email", "status", "residentName", "uploads");',
      "});",
    ],
    description:
      "Family member detail: name, email, the phone from their account, photo, relationship, isNextOfKin, status and joinedVia; the resident, room and home; familySize; uploads (pending, approved, rejected for this resident); and when they joined, who approved them and who removed them. A removed member can still be opened. memberId comes from the family members list. 404 for another organization's member. Needs familyEngagement.view; 404 when the module is off.",
  }),
  req("family group detail", "GET", ["admin", "organizations", "{{organizationId}}", "family-groups", "{{residentId}}"], {
    tests: [
      'pm.test("Family group fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("residentId", "residentName", "status", "primaryNextOfKin", "members", "summary");',
      "});",
    ],
    description:
      "Family Groups, the group page (the eye icon). The id is the resident's id. Resident details: residentName, photoUrl, roomNumber, homeName (Care site / Branch), branchId and status (active, invitePending, noFamily). primaryNextOfKin: name, photoUrl, relationship, email and phone (from their account); an invited next of kin who has not accepted yet shows with status invited and a null memberId; null when there is none. members: the Family Members (n) table, next of kin first then in the order they joined, each with memberId, name, photoUrl, email, phone, relationship, isNextOfKin (the NOK badge), status (active or inactive) and joinedAt. pendingInvitations lists invitations still waiting. summary: totalLinkedMembers, activePortalUsers (active members), pendingInvites and groupId. 404 resident_not_found for another organization's, a discharged or an unknown resident. Needs familyEngagement.view.",
  }),
  req("family groups", "GET", ["admin", "organizations", "{{organizationId}}", "family-groups"], {
    query: "page=1&limit=10",
    optional: {
      status: ["active", "Tab: active, invitePending or noFamily"],
      branchId: ["{{branchId}}", "One site"],
      keyword: ["margaret", "Search resident, next of kin or room"],
    },
    tests: [
      'pm.test("Family groups fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("total", "active", "invitePending", "noFamily");',
      "});",
    ],
    description:
      "Family Groups page: one row per admitted resident with nextOfKinName, nextOfKinRelationship, membersCount and status. Status is active (someone is linked), invitePending (only invitations out) or noFamily. Buttons: active shows Manage (GET residents/:residentId/members) and Invite (POST /admin/family-invitations); invitePending shows Manage and Resend (PUT /admin/family-invitations/:pendingInvitationId with action resend); noFamily shows Add next of kin (POST /admin/family-invitations with isNextOfKin true). meta.counts gives total, active, invitePending and noFamily for the cards and tabs; the counts ignore the status filter and follow branchId and keyword. Optional query: status, keyword (resident, room or next of kin), branchId, page, limit. Owners, super admins and managers with familyEngagement.view; 404 when the module is off.",
  }),
  req("all family members", "GET", ["admin", "organizations", "{{organizationId}}", "family-members"], {
    query: "page=1&limit=10",
    optional: {
      status: ["active", "Tab: active, pending, inactive, rejected or cancelled (removed members are never listed)"],
      branchId: ["{{branchId}}", "One site"],
      residentId: ["{{residentId}}", "One resident"],
      isNextOfKin: ["true", "Only next of kin (true) or everyone else (false)"],
      keyword: ["sarah", "Search member name or email, or the resident's name or room"],
    },
    tests: [
      'pm.test("All family members fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    pm.expect(pm.response.json().data).to.be.an(\"array\");",
      "});",
    ],
    description:
      "Every family member of the organization who has not been removed, across residents, whoever invited them. Without a status it lists active, pending and inactive; someone who was removed from a family is never listed or counted. Optional query: status (active, pending, inactive, rejected or cancelled), branchId, residentId, isNextOfKin, keyword (member name or email, or the resident's name or room), page, limit. Each row has the member (name, email, photo), relationship, isNextOfKin, status, the resident (name, room, photo), the home, joinedAt and joinedVia. meta.counts gives active, pending, inactive, rejected and cancelled (never removed) and ignores the status filter, so the totals and pages never include removed members. Needs familyEngagement.view; 404 when the module is off.",
  }),
  staff("family members", "GET", ["admin", "family", "residents", "{{residentId}}", "members"], {
    tests: [
      'pm.test("Family members fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data.members).to.be.an("array");',
      "    const removable = data.members.find((m) => m.status === \"active\" && !m.isNextOfKin);",
      '    if (removable) pm.collectionVariables.set("memberId", removable.memberId);',
      "});",
    ],
    description:
      "Everyone linked to the resident: next of kin first, then active members, then people waiting for approval. Includes email. Owner, super admin, site manager and line manager (a site or line manager only for their own site). Feeds: My Family.",
  }),
  {
    ...staff("set next of kin", "PUT", ["admin", "family", "residents", "{{residentId}}", "next-of-kin"], {
      tests: [
        'pm.test("Next of kin updated", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.isNextOfKin).to.eql(true);',
        "});",
      ],
      description:
        "Makes an active member the next of kin; the old next of kin steps down and stays a member. Also how the home finishes a \"let the home choose\" handover. Body: memberId. 409 if already next of kin or not approved yet, 404 for someone not linked to this resident. Figma screen: Leave Margaret's Family (Let Florence House Choose).",
    }),
  },
  staff("remove family member", "DELETE", ["admin", "family", "residents", "{{residentId}}", "members", "{{memberId}}"], {
    tests: [
      'pm.test("Family member removed", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("removed");',
      "});",
    ],
    description:
      "Removes an active member; their access ends on their next request. Unlike the family app, staff may remove the next of kin too, which leaves the resident without one. Any handover involving the person is cancelled. 409 for someone who is not approved yet (reject instead). Feeds: My Family.",
  }),
  staff("current family code", "GET", ["admin", "family", "residents", "{{residentId}}", "code"], {
    tests: [
      'pm.test("Family code fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.have.property("code");',
      "});",
    ],
    description:
      "The resident's current family code and expiry, or code: null. Feeds: Invite Family (family code card).",
  }),
  staff("make family code", "POST", ["admin", "family", "residents", "{{residentId}}", "code"], {
    tests: [
      'pm.test("Family code created", function () {',
      "    pm.response.to.have.status(201);",
      '    pm.collectionVariables.set("familyCode", pm.response.json().data.code);',
      "});",
    ],
    description:
      "The home makes a new family code (14 days); the old one stops working. Same rules as the next of kin making one.",
  }),
  staff("join requests", "GET", ["admin", "family", "join-requests"], {
    query: "residentId={{residentId}}&page=1&limit=10",
    tests: [
      'pm.test("Join requests fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.be.an("array");',
      '    if (data[0]) pm.collectionVariables.set("joinRequestId", data[0].requestId);',
      "});",
    ],
    description:
      "People waiting for approval, oldest first, paginated. Filter with residentId or branchId; without a filter an owner or super admin sees the whole organization and a site or line manager sees their own site.",
  }),
  staff("approve join request", "POST", ["admin", "family", "join-requests", "{{joinRequestId}}", "approve"], {
    tests: [
      'pm.test("Join request approved", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("active");',
      "});",
    ],
    description:
      "The home approves a request when the next of kin has not. 409 if already decided, 403 for another site, 404 for another organization's request.",
  }),
  staff("reject join request", "POST", ["admin", "family", "join-requests", "{{joinRequestId}}", "reject"], {
    tests: [
      'pm.test("Join request rejected", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("rejected");',
      "});",
    ],
    description: "The home declines a request. The person can ask again later.",
  }),
  staff("open handovers", "GET", ["admin", "family", "handovers"], {
    query: "homeChooses=true&page=1&limit=10",
    tests: [
      'pm.test("Handovers fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.be.an("array");',
      "});",
    ],
    description:
      "Open handover requests, oldest first, paginated: who asked, who they asked (to is null when the home chooses), and the resident. homeChooses=true shows only the families waiting for the home. Finish one with staff set next of kin. Feeds: Leave Margaret's Family (Let Florence House Choose).",
  }),
];
// PUT and DELETE keep their bodies/headers; the set-next-of-kin body is added below
staffRequests[1].request.body = jsonBody({ memberId: "{{memberId}}" });

// The decision requests share one PUT; the body's action picks approve or reject.
const uploadDecisions = [
  {
    name: "approve upload",
    body: { action: "approve" },
    status: "approved",
    description:
      "Approves a pending upload; the author is notified. Body: action approve. Needs familyEngagement.approve (a line manager only if granted) and, for site and line managers, an upload on their own site. 409 upload_already_decided (with the status) when another manager decided first.",
  },
  {
    name: "approve upload with blur",
    body: { action: "approve", blur: { "{{mediaId}}": [{ x: 0.1, y: 0.2, width: 0.3, height: 0.25 }] } },
    status: "approved",
    description:
      "Approve after blurring. blur maps a photo id of the upload to rectangles {x, y, width, height}, each a fraction of the photo (0 to 1) so the app does not need the stored size. The server saves a blurred copy, which is the only one ever shown to families, and keeps the original for audit. 400 invalid_blur_areas for a photo of another upload or rectangles outside the photo.",
  },
  {
    name: "reject upload",
    body: { action: "reject", reason: "Another resident is in the photo. Please crop and send again." },
    status: "rejected",
    description:
      "Rejects a pending upload. Body: action reject and reason (required, up to 500 characters). The author sees the reason under Not Approved and is notified; the upload is removed 30 days later.",
  },
];
uploadDecisions.forEach(({ name, body, status, description }) => {
  const request = staff(name, "PUT", ["admin", "family", "uploads", "{{uploadId}}"], {
    tests: [
      `pm.test("Upload ${status}", function () {`,
      "    pm.response.to.have.status(200);",
      `    pm.expect(pm.response.json().data.status).to.eql("${status}");`,
      "});",
    ],
    description,
  });
  request.request.body = jsonBody(body);
  staffRequests.push(request);
});

// Wall posts: create, edit and remove.
const wallPosts = [
  {
    name: "create post",
    method: "POST",
    path: ["admin", "family", "posts"],
    body: {
      branchId: "{{branchId}}",
      title: "Garden afternoon",
      message: "Garden afternoon: live music and scones on the lawn.",
      mediaIds: ["{{mediaId}}"],
      taggedResidentIds: ["{{residentId}}"],
      audience: "all",
      isPinned: false,
    },
    tests: [
      'pm.test("Post published", function () {',
      "    pm.response.to.have.status(201);",
      '    pm.expect(pm.response.json().data.status).to.eql("published");',
      '    pm.collectionVariables.set("postId", pm.response.json().data.postId);',
      "});",
    ],
    description:
      "Staff Community Wall: new post. Body: title (optional, up to 120 characters), branchId (a site or line manager posts to their own site and leaves it out. An owner or super admin can leave it out when the post is for tagged residents' families (the site is the one the tagged residents are at; tagged residents at two sites return 400 tagged_residents_different_sites) or when the organization has only one active site; otherwise they must send it, or get 400 branch_required), message (up to 2000 characters), mediaIds (up to 10, from upload post photo), taggedResidentIds (up to 50, only residents of that site with photo sharing on, from taggable residents) and isPinned. Needs text or a photo. audience is Who can see this post?: all (All Families & Residents, the default: every family in the organization, at every site), branch (the site's families, such as Florence House Families) or tagged (Tagged Resident Families Only: only the families of the residents tagged, so at least one resident must be tagged, 400 audience_needs_tags). 400 invalid_post_audience for any other value. Goes live straight away with no approval and the people the audience reaches get a notification: everyone in the organization, the site's families, or the families of the tagged residents. Optional status: published (default), draft (saved, nobody sees it) or scheduled; scheduledAt (an ISO date in the future, up to a year ahead, such as 2026-11-02T09:00:00Z) alone also means scheduled. Families are notified when a scheduled post goes live, which a job checks every minute. 400 post_schedule_invalid for a bad date. 400 residents_cannot_be_tagged for a resident with photo sharing off or at another site. Needs familyEngagement.manage.",
  },
  {
    name: "update post",
    method: "PUT",
    path: ["admin", "family", "posts", "{{postId}}"],
    body: { title: "Garden afternoon and raffle", message: "Garden afternoon: live music, scones and a raffle.", isPinned: true },
    tests: [
      'pm.test("Post updated", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description:
      "Edit the text, photos or tags, change who can see it (audience), or pin and unpin. Anything not sent stays as it was; changing the audience does not notify anyone again. Same checks as create. A site or line manager can only change their own site's posts. Families are not notified again for a published post. A draft or scheduled post can also get status (draft, scheduled or published) and scheduledAt: published makes it live now, notifies families and sets its posted time to now. 409 post_already_published when a published post is sent back to draft or scheduled.",
  },
  {
    name: "remove post",
    method: "DELETE",
    path: ["admin", "family", "posts", "{{postId}}"],
    tests: [
      'pm.test("Post removed", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("removed");',
      "});",
    ],
    description:
      "Removes the post from every feed and from future newsletters and gazettes. The row is kept. Sending it again returns 404.",
  },
];
wallPosts.forEach(({ name, method, path, body, tests, description }) => {
  const request = staff(name, method, path, { tests, description });
  if (body) request.request.body = jsonBody(body);
  staffRequests.push(request);
});

// Editing members and invitations, pausing access, and dismissing reports.
const adminActions = [
  {
    name: "generate gazettes",
    method: "POST",
    path: ["admin", "family", "gazette-issues"],
    body: { branchId: "{{branchId}}" },
    tests: [
      'pm.test("Gazettes are being built", function () {',
      "    pm.response.to.have.status(202);",
      "});",
    ],
    description:
      "The Generate all button. Works out what every resident's gazette will say for the site's current issue and answers at once (202); the PDFs are drawn in the background, so the rows show Building and then Ready as each one finishes. If the server stops while drawing, a scheduled job (every 5 minutes) draws any gazette that has stayed at Building for 20 minutes, once, so nothing stays stuck. Once an organization has saved its gazette schedule, a job also builds each site's issue by itself when its period closes (checked every 15 minutes; a site with no admitted residents is skipped and an issue that exists is never built twice), and reminds the people linked at the site three days before an issue closes. Body: branchId (an owner or super admin must pick the site; a site or line manager uses their own). With no gazette schedule saved the issue covers the last cycle's days; with one it is the issue that is open now. Asking again builds the same issue again: new messages come in, and gazettes already printed are left exactly as they are. The response has the issue (issueId, number, period, closesAt) and counts of what was built. Needs familyEngagement.manage.",
  },
  {
    name: "mark all gazettes printed",
    method: "PUT",
    path: ["admin", "family", "gazette-issues"],
    body: { action: "printed", branchId: "{{branchId}}" },
    tests: ['pm.test("Marked printed", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "The Mark printed button at the top of the page. Body: action printed, branchId (an owner or super admin must pick the site; a site or line manager uses their own) and optionally itemIds to mark only some. It works on the site's current issue, the one the page shows. Only gazettes that are Ready are marked, and the family of each one that moves to printed is notified once; printed, no-content and no-family ones are not touched. Returns how many were marked. Marking again changes nothing. Needs familyEngagement.manage; a site or line manager only for their own site.",
  },
  {
    name: "retry failed gazettes",
    method: "PUT",
    path: ["admin", "family", "gazette-issues"],
    body: { action: "retry", branchId: "{{branchId}}" },
    tests: ['pm.test("Retrying", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "Body: action retry and branchId (as for mark all gazettes printed). Gazettes of the site's current issue that failed to draw go back to Building and are drawn again in the background; their content is untouched. Returns how many are retrying.",
  },
  {
    name: "regenerate gazette",
    method: "PUT",
    path: ["admin", "family", "gazettes", "{{gazetteItemId}}"],
    body: { action: "regenerate" },
    tests: ['pm.test("Gazette redrawn", function () {', "    pm.response.to.have.status(200);", '    pm.expect(pm.response.json().data).to.include.keys("itemId", "messages");', "});"],
    description:
      "The refresh icon: picks up messages that arrived since and draws the PDF again, then returns the gazette like gazette detail. Optional body: removeUploadIds (messages in this gazette to take out for good; they never come back in a later issue) and uploadIds (exactly which messages go in, from the ones sent for this gazette, at least one and at most the cap; the rest wait for the next issue, which is how staff choose the final 30 when more were sent). 400 gazette_upload_invalid or gazette_selection_invalid for a bad choice. 409 gazette_already_printed once printed. Needs familyEngagement.manage; a site or line manager only on their own site.",
  },
  {
    name: "mark gazette printed",
    method: "PUT",
    path: ["admin", "family", "gazettes", "{{gazetteItemId}}"],
    body: { action: "printed" },
    tests: ['pm.test("Marked printed", function () {', "    pm.response.to.have.status(200);", '    pm.expect(pm.response.json().data.status).to.eql("printed");', "});"],
    description:
      "Marks one gazette as printed (who and when are kept). Printing is what publishes it to the family app, so the people actively linked to that resident get a 'Gazette no. 14 is ready' notification, once. It must have been drawn first (409 gazette_not_ready). Marking it again changes nothing, and a printed gazette can no longer be changed or redrawn.",
  },
  {
    name: "mark gazette given",
    method: "PUT",
    path: ["admin", "family", "gazettes", "{{gazetteItemId}}"],
    body: { action: "given", givenOn: "2026-10-30" },
    tests: ['pm.test("Given date saved", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "The day the home gave the printed gazette to the resident, which the family sees. Body: action given and optionally givenOn (2026-10-30; today when left out, never in the future). Only a printed gazette (409 gazette_not_printed). 400 gazette_given_invalid for a bad day.",
  },

  {
    name: "update family member",
    method: "PUT",
    path: ["admin", "family", "members", "{{memberId}}"],
    body: { relationship: "grandson" },
    tests: ['pm.test("Family member updated", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "Members: edit. Body: relationship (a value from family relationship options). Their name, email and phone belong to their own account and are not changed here. Only active, pending and inactive members; a site or line manager can only change their own site. Returns the member detail. Needs familyEngagement.manage.",
  },
  {
    name: "deactivate family member",
    method: "PUT",
    path: ["admin", "family", "members", "{{memberId}}", "access"],
    body: { action: "deactivate" },
    tests: [
      'pm.test("Family member deactivated", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("inactive");',
      "});",
    ],
    description:
      "Members: pause someone's access without removing them (they show as Inactive). The next of kin cannot be deactivated (409 next_of_kin_cannot_be_deactivated): set a new next of kin first. A handover that involved them is cancelled. Their login then reports accessState inactive. Needs familyEngagement.manage.",
  },
  {
    name: "activate family member",
    method: "PUT",
    path: ["admin", "family", "members", "{{memberId}}", "access"],
    body: { action: "activate" },
    tests: [
      'pm.test("Family member activated", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("active");',
      "});",
    ],
    description: "Members: switch a deactivated member's access back on. 409 family_member_not_inactive for anyone else. Needs familyEngagement.manage.",
  },
  {
    name: "edit family invitation",
    method: "PUT",
    path: ["admin", "family-invitations", "{{familyInvitationId}}"],
    body: { action: "edit", name: "Ellen Price", relationship: "niece" },
    tests: ['pm.test("Invitation updated", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "Invitations: edit (pencil). Body: action edit and at least one of name, relationship. Only a pending invitation that has not expired (409 invitation_not_editable otherwise). The email and the link stay the same. Returns the invitation detail. Needs familyEngagement.manage.",
  },
  {
    name: "delete family invitation",
    method: "DELETE",
    path: ["admin", "family-invitations", "{{familyInvitationId}}"],
    tests: ['pm.test("Invitation deleted", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "Invitations: delete (trash on a revoked one). Only a revoked or expired invitation can be deleted; a pending one must be revoked first and an accepted one stays as the record (409 invitation_cannot_be_deleted). Needs familyEngagement.manage.",
  },
  {
    name: "dismiss post reports",
    method: "PUT",
    path: ["admin", "family", "posts", "{{postId}}", "reports"],
    body: { action: "dismiss" },
    tests: ['pm.test("Reports dismissed", function () {', "    pm.response.to.have.status(200);", "});"],
    description:
      "Community Wall: the reports on a post are judged unfounded; the post stays and its open reports close. Removing the post instead closes them as actioned. A site or line manager can only act on their own site. Needs familyEngagement.manage.",
  },
];

// Newsletter drafts: create, edit and remove.
const newsletterRequests = [
  {
    name: "create newsletter",
    method: "POST",
    path: ["admin", "family", "newsletters"],
    body: { branchId: "{{branchId}}", month: "2026-10" },
    tests: [
      'pm.test("Newsletter draft created", function () {',
      "    pm.response.to.have.status(201);",
      '    pm.expect(pm.response.json().data.status).to.eql("draft");',
      '    pm.collectionVariables.set("newsletterId", pm.response.json().data.newsletterId);',
      "});",
    ],
    description:
      "Newsletters: pick the month (the Newsletter month dropdown). Body: branchId (an owner or super admin must pick the site; a site or line manager uses their own), month (2026-10), and optionally title and template (classic, the only one for now). One newsletter per site and month (409 newsletter_exists_for_month); remove the draft to start again. The draft is filled in: highlights from the month's live wall posts, gallery from their photos, new residents admitted that month with photo sharing on, the footer from the site, the standard Share your photos notice, and who signs it (your name and role, such as Claire Adams, Site Manager). The response is the whole builder: the sections with their switches, the preview content (the home, organizationName, periodLabel and issueNumber for the Issue 14 line), counts for each section, and recipients {families, members} for the 42 families badge. Needs familyEngagement.manage.",
  },
  {
    name: "update newsletter",
    method: "PUT",
    path: ["admin", "family", "newsletters", "{{newsletterId}}"],
    body: {
      title: "October newsletter",
      sections: { gallery: true, notices: true },
      welcome: { text: "Welcome to our October newsletter. It has been a lovely month.", signedBy: "Claire Adams, Site Manager" },
      comingUp: [
        { date: "2026-10-07", time: "10:30", title: "Flu jabs", description: "Annual winter wellness clinic", category: "Health" },
        { date: "2026-10-17", time: "14:00", title: "Music session", description: "Acoustic guitar in the garden lounge", category: "Social" },
      ],
      notices: [{ title: "Half-term visiting", body: "Visiting runs as normal. Please book weekend visits through the TempyHub app." }],
      footer: { phone: "0113 000 0000", email: "hello@florencehouse.example" },
      delivery: { inApp: true, email: true, pdf: true },
    },
    tests: [
      'pm.test("Newsletter saved", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description:
      "Save draft (and every edit on the builder). Only a draft. Body, all optional: title, template, sections (welcome, highlights, comingUp, notices, newResidents, gallery as true or false), welcome {text, signedBy}, highlights [{postId, title, text, mediaId}], comingUp [{date, time (14:30), title, description, category}] (kept in date order), notices [{title, body}], newResidentIds [residentId], gallery [{mediaId, caption}], footer {homeName, address, phone, email}, delivery {inApp, email, pdf} (the choices under Send & Delivery), refill (a list of sections to pull from the wall again: highlights, gallery, newResidents; use it after new wall posts were added, it replaces only the named sections and a list sent in the same request wins). A list sent replaces the whole list; anything not sent is left alone. Highlights must be live posts of the site, gallery photos must come from them, and new residents must be admitted residents of the site with photo sharing on. 409 once scheduled or sent. Needs familyEngagement.manage.",
  },
  {
    name: "send newsletter",
    method: "PUT",
    path: ["admin", "family", "newsletters", "{{newsletterId}}", "delivery"],
    body: { action: "send", delivery: { inApp: true, email: true, pdf: true } },
    tests: [
      'pm.test("Newsletter sent", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("sent");',
      "});",
    ],
    description:
      "Send & Delivery: the Send newsletter button (When: Send now). Body: action send, and optionally delivery {inApp, email, pdf} to set the checkboxes now; without it the choices saved on the draft are used and at least one must be on (400 newsletter_delivery_required). A newsletter needs at least one switched-on section with something in it (400 newsletter_empty). Channels: inApp notifies every active family member at the site once each; pdf draws the PDF and stores it (pdfKey); email sends each distinct family address its own message (nobody sees another address) with the PDF attached. The email is sent only when EMAIL_ENABLED is true on the server; otherwise the channel is recorded as skipped. deliveryLog says what happened per channel: done with count (and failed), failed, or skipped. A failing address does not stop the others. Sending is done before the response returns, so a very large home takes longer. Posts removed, or residents whose photo sharing was switched off, since the draft are left out. The response is the sent newsletter with status sent, sentAt, sentBy, sentTo {families, members} and deliveryLog. One send wins if it is clicked twice (409 newsletter_already_sent for the other). Progress is written after each channel, and a send that stops part-way (the server died) is finished by the scheduler job after 15 minutes without progress: finished channels are skipped and nobody is notified or emailed twice. Needs familyEngagement.manage.",
  },
  {
    name: "schedule newsletter",
    method: "PUT",
    path: ["admin", "family", "newsletters", "{{newsletterId}}", "delivery"],
    body: { action: "schedule", sendAt: "2026-11-02T09:00:00Z", delivery: { inApp: true, email: true, pdf: true } },
    tests: [
      'pm.test("Newsletter scheduled", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("scheduled");',
      "});",
    ],
    description:
      "Send & Delivery: Schedule for later. Body: action schedule, sendAt (an ISO date in the future, up to a year ahead) and optionally delivery. Calling it again on a scheduled newsletter moves it to a new time. While scheduled it cannot be edited or deleted; cancel the schedule first. A job checks every minute and sends what is due, on behalf of the person who scheduled it. 400 newsletter_send_at_invalid for a bad time.",
  },
  {
    name: "cancel newsletter schedule",
    method: "PUT",
    path: ["admin", "family", "newsletters", "{{newsletterId}}", "delivery"],
    body: { action: "cancel" },
    tests: [
      'pm.test("Schedule cancelled", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.status).to.eql("draft");',
      "});",
    ],
    description: "Takes a scheduled newsletter back to a draft so it can be edited again. 409 newsletter_not_scheduled for anything else.",
  },
  {
    name: "remove newsletter",
    method: "DELETE",
    path: ["admin", "family", "newsletters", "{{newsletterId}}"],
    tests: [
      'pm.test("Newsletter removed", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description: "Removes a draft and frees its month. 409 for a scheduled or sent newsletter.",
  },
];
[...adminActions, ...newsletterRequests].forEach(({ name, method, path, body, tests, description }) => {
  const request = staff(name, method, path, { tests, description });
  if (body) request.request.body = jsonBody(body);
  staffRequests.push(request);
});

// ---------------------------------------------------------------- Visits (staff side)
staffRequests.push(
  req("family visits", "GET", ["admin", "organizations", "{{organizationId}}", "family-visits"], {
    query: "page=1&limit=10",
    optional: {
      status: ["requested", "requested, confirmed, declined, cancelled or invited"],
      source: ["family", "family (a request) or home (an invitation)"],
      range: ["upcoming", "upcoming or past"],
      branchId: ["{{branchId}}", "One site"],
      residentId: ["{{residentId}}", "One resident"],
    },
    tests: [
      'pm.test("Family visits fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    if (json.data.length) { pm.collectionVariables.set("familyVisitId", json.data[0].id); }',
      "});",
    ],
    description:
      "Visit requests and invitations for the organization in the path, soonest first. Optional query: status, source, range, branchId, residentId, page, limit. A site or line manager sees their own site. Each row has the resident, source, status, startAt, endAt, partySize, note, decisionNote, requestedBy (name, photo and email for a request) and answers {going, cantMakeIt} for an invitation. Needs familyEngagement.view; 404 when the module is off.",
  }),
  withBody(
    staff("invite family to a visit", "POST", ["admin", "family", "visits"], {
      tests: [
        'pm.test("Family invited", function () {',
        "    pm.response.to.have.status(201);",
        '    pm.expect(pm.response.json().data.status).to.eql("invited");',
        '    pm.collectionVariables.set("familyVisitId", pm.response.json().data.id);',
        "});",
      ],
      description:
        "Invite a resident's family to a visit (it shows as From The Home in My Visits). Body: residentId, date (YYYY-MM-DD), startTime and endTime (HH:mm, in the site's timezone), optional note (up to 500). Every family member answers for themselves. Needs familyEngagement.manage.",
    }),
    { residentId: "{{residentId}}", date: "{{visitDate}}", startTime: "14:00", endTime: "16:00", note: "Afternoon tea with the residents" }
  ),
  withBody(
    staff("confirm visit request", "PUT", ["admin", "family", "visits", "{{familyVisitId}}"], {
      tests: [
        'pm.test("Visit confirmed", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("confirmed");',
        "});",
      ],
      description:
        "PUT with body {\"action\":\"confirm\"} and an optional note (up to 200 characters). Confirms a family's request and creates the ordinary visitor invitation the kiosk already understands, so the visitor checks in with that code. 409 visit_not_pending when it was already answered or has passed. Needs familyEngagement.approve.",
    }),
    { action: "confirm", note: "See you then" }
  ),
  withBody(
    staff("decline visit request", "PUT", ["admin", "family", "visits", "{{familyVisitId}}"], {
      tests: [
        'pm.test("Visit declined", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("declined");',
        "});",
      ],
      description:
        "PUT with body {\"action\":\"decline\"} and an optional note (up to 200 characters) the family reads in My Visits. 409 visit_not_pending when it was already answered or has passed. Needs familyEngagement.approve.",
    }),
    { action: "decline", note: "Sorry, that afternoon is fully booked" }
  ),
  withBody(
    staff("cancel family visit", "PUT", ["admin", "family", "visits", "{{familyVisitId}}"], {
      tests: [
        'pm.test("Visit cancelled", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("cancelled");',
        "});",
      ],
      description:
        "PUT with body {\"action\":\"cancel\"}. Cancels a request, a confirmed visit or an invitation that has not happened yet, and withdraws every kiosk code issued for it. 409 visit_not_cancellable otherwise. Needs familyEngagement.approve.",
    }),
    { action: "cancel" }
  ),
);

// ---------------------------------------------------------------- Chat: messages from the home (one-way)
// These live under /chats, not under family, app or admin. Earlier runs put them in those folders, so clear them first.
const OLD_CHAT_FOLDERS = ["Messages", "Messages (Site and Line Manager)"];
const OLD_CHAT_REQUESTS = [
  "send family message", "sent family messages", "sent family message detail",
  "app send family message", "app sent family messages", "app sent family message detail",
  "my chats", "chat messages", "update chat",
  "send chat message", "sent chat messages", "sent chat message detail",
];
const dropOldChat = (node, inFamily = false) => {
  if (!node.item) return;
  node.item = node.item.filter((i) => !(i.item && inFamily && OLD_CHAT_FOLDERS.includes(i.name)));
  node.item = node.item.filter((i) => !(i.item && i.name === "Messages (Site and Line Manager)"));
  node.item = node.item.filter((i) => !(i.request && inFamily && OLD_CHAT_REQUESTS.includes(i.name)));
  node.item.forEach((i) => dropOldChat(i, inFamily || /^(Family|Family Engagement|App|Admin Panel)$/.test(i.name)));
};
dropOldChat(collection);

// Postman accepts // comments in a JSON body and removes them when the request is sent.
const withRawBody = (request, rawJson) => {
  request.request.body = { mode: "raw", raw: rawJson, options: { raw: { language: "json" } } };
  return request;
};

const SEND_RAW_BODY = `{
  // audience: send ONE of these three. Change the value below, the other fields for it are already filled in.
  //   "all"      every active next of kin at the site. No other field is needed.
  //   "selected" the next of kin of the residents in residentIds (1 to 100 residents of the site).
  //   "people"   the next of kin in recipientIds (1 to 200 ids, from the "recipients" request).
  "audience": "selected",

  // used only when audience is "selected"
  "residentIds": ["{{residentId}}"],

  // used only when audience is "people"
  "recipientIds": ["{{recipientId}}"],

  // plain text, up to 2000 characters
  "message": "The garden party is on Friday at 2pm. Everyone is welcome.",

  // an owner or super admin must send it; a site or line manager uses their own site
  "branchId": "{{branchId}}"
}`;

const chatRequests = [
  // ---- family app (Login Family)
  req("chats", "GET", ["chats"], {
    query: "page=1&limit=20",
    optional: { chatState: ["inbox", "inbox (default), favorite or archived; 400 invalid_chat_tab for anything else"] },
    tests: [
      'pm.test("Chats fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta).to.have.property("unread");',
      '    if (json.data.length) { pm.collectionVariables.set("conversationId", json.data[0].conversationId); }',
      "});",
    ],
    description:
      "FAMILY token (Login Family). Messages from the home, one thread per home, newest first. Only active next of kin see anything; anyone else gets an empty list. Each row has conversationId, chatName (the home's name), chatState, unreadCount, canMessage (always false: families cannot reply, so hide the composer) and lastMessage (messageContent, senderName, createdAt). meta.unread is the unread total for the badge. Live updates: connect to the /chat socket with auth {token} (the same login token) and listen for receiveMessage; the room is taken from the token, and the socket cannot send anything. Sets conversationId.",
  }),
  req("messages", "GET", ["chats", "messages"], {
    query: "conversationId={{conversationId}}&page=1&limit=20",
    tests: [
      'pm.test("Chat messages fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      "    pm.expect(json.meta.conversation.canMessage).to.eql(false);",
      "});",
    ],
    description:
      "FAMILY token. The messages in one thread, newest first: _id, senderName, messageContent, createdAt and isRead (as it was when the thread was opened). Opening the first page marks the whole thread read and clears unreadCount, which the home sees in its sent list. 404 conversation_not_found for anyone else's thread, or once the person is no longer next of kin.",
  }),
  withBody(
    req("chats action", "PUT", ["chats", "{{conversationId}}", "action"], {
      tests: [
        'pm.test("Chat updated", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data).to.have.property("chatState");',
        "});",
      ],
      description:
        'FAMILY token. PUT with body {"action":"favorite"}: action is default (back to the inbox), favorite or archived; 400 invalid_chat_action for anything else. It only changes how this person sees the thread.',
    }),
    { action: "favorite" }
  ),
  // ---- the home: site manager, line manager, owner (Login Staff)
  withRawBody(
    staff("sendMessage", "POST", ["chats", "message"], {
      tests: [
        'pm.test("Message sent", function () {',
        "    pm.response.to.have.status(201);",
        "    const data = pm.response.json().data;",
        "    pm.expect(data.recipients).to.be.above(0);",
        '    pm.collectionVariables.set("broadcastId", data.broadcastId);',
        "});",
      ],
      description:
        "STAFF token (Login Staff or Login line Manager). A message from the home to next of kin; they read it in the app and cannot reply. Body: audience (all: every active next of kin at the site; selected: the next of kin of residentIds, one to 100 residents of that site; people: the next of kin in recipientIds, one to 200 people from recipients), message (plain text, up to 2000 characters) and branchId (a site or line manager uses their own site; an owner or super admin must send it, or get 400 branch_required). Only active next of kin are reached, each person once even when they are next of kin of several chosen residents; carers and family members who are not next of kin are not. Each person has one thread per home, gets an in-app notification and a live push. Returns broadcastId, sentAt, recipients, conversationId (set when exactly one person got it), residentsWithoutNextOfKin and recipientsNotReached (people who are not next of kin at this site); 400 message_no_recipients when nobody could be reached, 404 resident_not_found for a resident of another site, 403 outside_managed_branch for another site. Sets broadcastId. Needs familyEngagement.manage; rate limited.",
    }),
    SEND_RAW_BODY
  ),
  staff("contacts", "GET", ["chats", "contacts"], {
    query: "page=1&limit=20",
    optional: {
      branchId: ["{{branchId}}", "One site (an owner picks one; a site or line manager always gets their own)"],
      keyword: ["ann", "Search contacts: part of the name, taken literally"],
    },
    tests: [
      'pm.test("Contacts fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    if (json.data.length) { pm.collectionVariables.set("conversationId", json.data[0].conversationId); }',
      "});",
    ],
    description:
      "STAFF token. The left panel of the web Messages page: one row per next of kin the home has messaged, newest message first. Each row has conversationId, recipientId, name, photoUrl, email, roleLabel (Next of kin), residents (name, roomNumber, phone, email of the residents they are next of kin of), homeName, unreadCount, notRead (true while they have not opened the latest message: the dot) and lastMessage (messageContent, senderName, createdAt, readAt). Optional query: branchId, keyword (Search contacts), page, limit. Sets conversationId. Needs familyEngagement.view.",
  }),
  staff("messages by contact", "GET", ["chats", "contacts", "{{conversationId}}"], {
    query: "page=1&limit=20",
    tests: [
      'pm.test("Contact thread fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.contact).to.include.keys("name", "roleLabel", "email", "phone", "residents");',
      "});",
    ],
    description:
      "STAFF token. The middle and right panels for one contact. data is everything the home has sent them, newest first: _id, messageContent, senderName (which manager sent it), createdAt, readAt and isRead. The thread is read-only: the contact cannot reply, so there are no incoming messages, and opening it changes nothing for the contact. meta.contact is the right panel: name, photoUrl, roleLabel, email, phone, homeName and residents (name, roomNumber, phone, email). 404 conversation_not_found for another site's contact. Needs familyEngagement.view.",
  }),
  staff("recipients", "GET", ["chats", "recipients"], {
    query: "page=1&limit=20",
    optional: {
      branchId: ["{{branchId}}", "One site (an owner picks one; a site or line manager always gets their own)"],
      keyword: ["bob", "Part of the name, taken literally"],
    },
    tests: [
      'pm.test("Recipients fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    if (json.data.length) { pm.collectionVariables.set("recipientId", json.data[0].recipientId); }',
      "});",
    ],
    description:
      "STAFF token. The To: Recipients picker: the active next of kin the home can message, one row per person, by name: recipientId, name, photoUrl, email, roleLabel and residents (name, roomNumber). Carers and other family members are not listed. Optional query: branchId, keyword, page, limit. Send the chosen recipientIds to sendMessage people. Sets recipientId. Needs familyEngagement.view.",
  }),
  withBody(
    staff("sendMessage people", "POST", ["chats", "message"], {
      tests: [
        'pm.test("Message sent", function () {',
        "    pm.response.to.have.status(201);",
        "    pm.expect(pm.response.json().data.recipients).to.be.above(0);",
        "});",
      ],
      description:
        "STAFF token. The To: Recipients field with chosen people. Body: audience people, recipientIds (one to 200 ids from recipients), message (up to 2000 characters) and branchId (an owner or super admin must send it; a site or line manager uses their own site). Only active next of kin at that site are reached; anyone else is returned in recipientsNotReached. 400 message_no_recipients when nobody could be reached, 400 invalid_message_audience for a bad list. Needs familyEngagement.manage; rate limited.",
    }),
    { audience: "people", recipientIds: ["{{recipientId}}"], message: "Just a reminder that visiting is open this weekend.", branchId: "{{branchId}}" }
  ),
  withBody(
    staff("sendMessage with conversation", "POST", ["chats", "message"], {
      tests: [
        'pm.test("Message sent", function () {',
        "    pm.response.to.have.status(201);",
        '    pm.expect(pm.response.json().data).to.have.property("conversationId");',
        "});",
      ],
      description:
        "STAFF token. The Type a message box inside a thread: another message to the same contact. Body: conversationId (from contacts) and message (up to 2000 characters). The site comes from the conversation. 404 conversation_not_found for another site's contact, 400 message_no_recipients when they are no longer next of kin. Needs familyEngagement.manage; rate limited.",
    }),
    { conversationId: "{{conversationId}}", message: "Thank you for your patience. We will confirm the date soon." }
  ),
  staff("sent", "GET", ["chats", "sent"], {
    query: "page=1&limit=20",
    optional: { branchId: ["{{branchId}}", "One site (an owner picks one)"], keyword: ["garden", "Part of the message text"] },
    tests: [
      'pm.test("Sent messages fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    if (json.data.length) { pm.collectionVariables.set("broadcastId", json.data[0].broadcastId); }',
      "});",
    ],
    description:
      "STAFF token. What the home has sent, newest first: one row per message however many people got it. Each row has broadcastId, message, homeName, sentByName and sentByPhotoUrl, sentAt, recipients and readCount. Optional query: branchId, keyword (part of the text, taken literally), page, limit. A site or line manager sees their own site. Sets broadcastId. Needs familyEngagement.view.",
  }),
  staff("sent by broadcastId", "GET", ["chats", "sent", "{{broadcastId}}"], {
    query: "page=1&limit=20",
    tests: [
      'pm.test("Sent message fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().meta.message).to.include.keys("message", "recipients", "readCount");',
      "});",
    ],
    description:
      "STAFF token. One sent message and who got it: meta.message has the summary (message, homeName, sentBy, sentAt, recipients, readCount) and data has each recipient with name, email and readAt (null until they open it), paged. 404 message_not_found for an unknown message or one at another site. Needs familyEngagement.view.",
  }),
];

collection.item = collection.item.filter((i) => i.name !== "Chat" && i.name !== "Conversation/Messages");
let chatFolder = collection.item.find((i) => i.name === "Conversation/Messages");
if (!chatFolder) {
  chatFolder = {
    name: "Conversation/Messages",
    description: "Messages from the home to next of kin, one way. Use a family token to read them and a staff token (site manager, line manager, owner) to send.",
    item: [],
  };
  collection.item.push(chatFolder);
}
for (const request of chatRequests) {
  const idx = chatFolder.item.findIndex((r) => r.name === request.name);
  if (idx >= 0) chatFolder.item[idx] = request;
  else chatFolder.item.push(request);
}

let staffFolder = adminFolder.item.find((i) => i.name === "Family Management");
if (!staffFolder) {
  staffFolder = { name: "Family Management", item: [] };
  adminFolder.item.push(staffFolder);
}
// requests were once named "staff ..."; drop those so the renamed ones do not duplicate them
staffFolder.item = staffFolder.item.filter((r) => !/^staff /.test(r.name));
for (const request of staffRequests) {
  const idx = staffFolder.item.findIndex((r) => r.name === request.name);
  if (idx >= 0) staffFolder.item[idx] = request;
  else staffFolder.item.push(request);
}

// ---------------------------------------------------------------- Visit Requests (site manager and line manager app)
const managerRequests = [
  staff("app visit requests", "GET", ["app", "family-visits"], {
    query: "page=1&limit=20",
    optional: {
      branchId: ["{{branchId}}", "The site. A site or line manager uses their own; an owner picks one"],
      status: ["requested", "requested (default), confirmed, declined, cancelled or invited"],
      range: ["upcoming", "upcoming (default) or past"],
      residentId: ["{{residentId}}", "One resident"],
    },
    tests: [
      'pm.test("Visit requests fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta).to.have.property("visiting");',
      '    if (json.data.length) { pm.collectionVariables.set("familyVisitId", json.data[0].id); }',
      "});",
    ],
    description:
      "Visit Requests screen of the site manager and line manager apps: the requests waiting for an answer, soonest first. meta.totalRecords is the Requests (2) count and meta.visiting {paused, reason, since} drives the Pause Visiting card. Each row has the resident (residentName), requestedBy {name, photoUrl, email}, startAt, endAt, place, partySize and note: 'Sarah Hughes for Margaret Hughes, 3 people, Bringing a birthday cake'. A site or line manager sees their own site. Send the x-org-id header.",
  }),
  withBody(
    staff("app approve visit request", "PUT", ["app", "family-visits", "{{familyVisitId}}"], {
      tests: [
        'pm.test("Visit approved", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("confirmed");',
        "});",
      ],
      description:
        'PUT with body {"action":"approve"} and an optional note (up to 200 characters). The Approve button: confirms the request and creates the kiosk code the family shows on their Visit Pass. 409 visit_not_pending when it was already answered or has passed.',
    }),
    { action: "approve", note: "See you then" }
  ),
  withBody(
    staff("app decline visit request", "PUT", ["app", "family-visits", "{{familyVisitId}}"], {
      tests: [
        'pm.test("Visit declined", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("declined");',
        "});",
      ],
      description:
        'PUT with body {"action":"decline"} and an optional note (up to 200 characters) the family reads in My Visits. The Decline button. The seats the request held are free again.',
    }),
    { action: "decline", note: "Sorry, that time is fully booked" }
  ),
  withBody(
    staff("app pause visiting", "PUT", ["app", "family-visits", "visiting"], {
      tests: [
        'pm.test("Visiting paused", function () {',
        "    pm.response.to.have.status(200);",
        "    const data = pm.response.json().data;",
        '    pm.expect(data.paused).to.eql(true);',
        '    pm.expect(data).to.have.property("cancelled");',
        "});",
      ],
      description:
        'PUT with body {"action":"pause","branchId":"...","reason":"..."}. The Pause Visiting button: stops new requests at once, cancels every visit still to come at the site, withdraws the kiosk codes issued for them and notifies the families affected. cancelled is how many visits were cancelled. Sending it again cancels nothing more. branchId is needed for an owner; a site or line manager uses their own site. reason is optional (up to 200 characters) and is shown to the families.',
    }),
    { action: "pause", branchId: "{{branchId}}", reason: "Visiting is paused while we deal with a flu outbreak" }
  ),
  withBody(
    staff("app resume visiting", "PUT", ["app", "family-visits", "visiting"], {
      tests: [
        'pm.test("Visiting resumed", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.paused).to.eql(false);',
        "});",
      ],
      description:
        'PUT with body {"action":"resume","branchId":"..."}. Families can book again. Visits cancelled by the pause are not brought back.',
    }),
    { action: "resume", branchId: "{{branchId}}" }
  ),
];

let managerFolder = appFolder.item.find((i) => i.name === "Visit Requests (Site and Line Manager)");
if (!managerFolder) {
  managerFolder = { name: "Visit Requests (Site and Line Manager)", item: [] };
  appFolder.item.push(managerFolder);
}
for (const request of managerRequests) {
  const idx = managerFolder.item.findIndex((r) => r.name === request.name);
  if (idx >= 0) managerFolder.item[idx] = request;
  else managerFolder.item.push(request);
}

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

// One PUT per record: the body's action picks approve / reject / cancel and so on.
// Postman keeps a request per action so each can be sent on its own.
const toAction = (request, action) => {
  const parts = request.request.url.path;
  parts.pop();
  request.request.method = "PUT";
  request.request.url.raw = `{{url}}/${parts.join("/")}`;
  request.request.body = jsonBody({ action });
  request.request.description =
    `PUT with body {"action":"${action}"}. ` + (request.request.description || "");
};
const byName = (list, name) => {
  const found = list.find((r) => r.name === name);
  if (!found) throw new Error(`request not found: ${name}`);
  return found;
};
for (const [name, action] of [
  ["cancel join request", "cancel"],
  ["approve join request", "approve"],
  ["reject join request", "reject"],
  ["accept handover", "accept"],
  ["decline handover", "decline"],
  ["cancel handover", "cancel"],
]) {
  toAction(byName(requests, name), action);
}
for (const [name, action] of [
  ["approve join request", "approve"],
  ["reject join request", "reject"],
]) {
  toAction(byName(staffRequests, name), action);
}
const familyInvitationsFolder = adminFolder.item.find((i) => i.name === "Family Invitations");
for (const [name, action] of [
  ["resend family invitation", "resend"],
  ["revoke family invitation", "revoke"],
]) {
  const found = familyInvitationsFolder && familyInvitationsFolder.item.find((r) => r.name === name);
  if (found) {
    const parts = found.request.url.path;
    if (parts[parts.length - 1] === action) {
      toAction(found, action);
    } else {
      found.request.body = jsonBody({ action });
    }
  }
}

// The invitations list lives under the organization, like the members and invitations lists of staff.
const requestsUnder = (item) => (item.item ? item.item.flatMap(requestsUnder) : [item]);
const familyInvitationItems = requestsUnder(adminFolder);
const allInvitations = familyInvitationItems.find((r) => r.name === "list family invitations");
const invitationDetail = familyInvitationItems.find((r) => r.name === "get family invitation");
if (invitationDetail) {
  const path = ["admin", "organizations", "{{organizationId}}", "family-invitations", "{{familyInvitationId}}"];
  invitationDetail.request.url.path = path;
  invitationDetail.request.url.raw = `{{url}}/${path.join("/")}`;
  invitationDetail.request.header = (invitationDetail.request.header || []).filter(
    (h) => String(h.key).toLowerCase() !== "x-org-id"
  );
  invitationDetail.request.description =
    "Family invitation detail: name, email, relationship, isNextOfKin, status (a pending one past its expiry reads as expired), the resident, room and home, who invited, createdAt, expiresAt, lastSentAt, sendCount, and who accepted or revoked it. The token hash is never returned. 404 for another organization's invitation. Needs familyEngagement.view; 404 when the module is off.";
}
if (allInvitations) {
  const path = ["admin", "organizations", "{{organizationId}}", "family-invitations"];
  allInvitations.request.url.path = path;
  allInvitations.request.url.raw = `{{url}}/${path.join("/")}?page=1&limit=10&status=pending`;
  allInvitations.request.url.query = [
    { key: "page", value: "1" },
    { key: "limit", value: "10" },
    { key: "status", value: "pending" },
    ...optionalParams({
      branchId: ["{{branchId}}", "One site"],
      residentId: ["{{residentId}}", "One resident"],
      keyword: ["emily", "Search name, email, or the resident's name or room"],
    }),
  ];
  allInvitations.request.header = (allInvitations.request.header || []).filter(
    (h) => String(h.key).toLowerCase() !== "x-org-id"
  );
  allInvitations.request.description =
    "Every family invitation of the organization in the path, whoever sent it, newest first. Optional query: branchId, status, residentId, keyword (name, email, or the resident's name or room), page, limit. Rows carry the resident (name, room, photo), the home, who invited, status (a pending one past its expiry reads as expired), expiresAt and lastSentAt. meta.counts has pending, accepted, revoked and expired and ignores the status filter. Needs familyEngagement.view; 404 when the module is off.";
}

// Requests saved by an earlier run may still say PATCH.
const retire = (item) => {
  if (item.item) return item.item.forEach(retire);
  if (item.request && item.request.method === "PATCH" && /family|invitation/i.test(item.request.url.raw || "")) {
    item.request.method = "PUT";
    item.request.description = (item.request.description || "").replace("PATCH with body", "PUT with body");
  }
};
retire(collection);

// ---------------------------------------------------------------- Billing & Usage
const billingHeader = orgHeader;
const billingRequests = [
  req("usage", "GET", ["admin", "billing", "usage"], {
    query: "page=1&limit=10",
    optional: {
      organizationId: ["{{organizationId}}", "Platform admin only: one organization (the Filter by Organization dropdown)"],
      keyword: ["bluebell", "Organization name, owner name or owner email"],
      sort: ["usedDesc", "usedDesc (default), usedAsc, percentDesc or name"],
    },
    header: billingHeader,
    tests: [
      'pm.test("Usage fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.summary).to.include.keys("activeOrganizations", "totalUsedGb", "quotaPercent", "images", "files", "billing");',
      "});",
    ],
    description: "The Billing & Usage screen in one call. Any signed-in role may call it: Super Admin (platform admin), owner, site manager, line manager or staff. Who sees what: a Super Admin (platform admin, Admin Login, no x-org-id) gets one row per active organization, and passes organizationId (clicking an organization, or the Filter by Organization dropdown) to get that organization's branches the way its owner sees them: one row per branch, the cards of that organization and the organization itself in meta.organization. An owner (or an organization's super admin) sends x-org-id and gets one row per branch of their organization, with their organization itself in meta.organization. A site manager, line manager or staff member sends x-org-id and gets only their own branch. Query: organizationId (platform admin only: the Filter by Organization dropdown), keyword (organization name, owner name or owner email for a platform admin; branch name or owner name or email for the others), sort (usedDesc is the default, usedAsc, percentDesc or name), page, limit (default 10). data has one row per organization for a platform admin: organizationId, name, owner {name, email}, usedGb, planLimitGb (the same for every organization; null until the platform admin sets it), usagePercent, status (normal below 60%, moderate from 60%, high from 90%, overPlan above 100%, noLimit when no limit is set) with statusLabel, images {gb, percentOfUsed, count}, files {gb, percentOfUsed, count} (PDFs, documents and records), emergencyNotifyOffsite, measuredAt, measuring, unmeasured and canEdit. A branch row (owner, site manager, line manager, staff) has branchId, organizationId, name, owner {name, email} (the organization's owner), usedGb, planLimitGb (the organization's limit, shared by its branches), usagePercent (the branch's share of that limit) with status and statusLabel, images, files, measuredAt, unmeasured and canEdit (always false). The pencil opens Edit Organization: show it on an organization row when canEdit is true (a platform admin, an owner or a super admin) and fill the dialog from the row (name, owner name and email, which cannot be changed, and emergencyNotifyOffsite); Save Changes is update organization (PUT /admin/organizations/:organizationId with name and settings.emergencyNotifyOffsite). meta.summary is the four cards for everything in scope, ignoring the search (all organizations for a platform admin, the organization for an owner, the one branch for a site manager, line manager or staff member): activeOrganizations, totalUsedGb with quotaPercent (used against planLimitGb for each organization, which is totalPlanGb), planLimitGb, images {gb, percentOfTotal, count}, files {gb, percentOfTotal, count} and billing {status withinPlan or overPlan, label, organizationsOver, overageGb, overageChargeGbp, baseTierGbp, overageGbpPerGb}. A platform admin also gets meta.organizations for the dropdown. GB here are 1024 x 1024 x 1024 bytes. Usage is measured from the storage bucket every night, so measuredAt says how fresh it is.",
  }),
  req("usage detail", "GET", ["admin", "billing", "usage", "{{organizationId}}"], {
    header: billingHeader,
    optional: {
      branchId: ["{{branchId}}", "One branch of the organization: its own usage detail"],
    },
    tests: [
      'pm.test("Usage detail fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("organization", "storage", "categories", "branches", "billing", "record");',
      '    pm.expect(data.categories).to.be.an("array");',
      "});",
    ],
    description: "The usage detail page of one organization (click a row on the Billing & Usage table). The id in the path is organizationId. Only a Super Admin (platform admin, no x-org-id) or the owner or super admin of that organization (send x-org-id with the same id) can open it; a site manager, line manager or staff member gets 403 insufficient_role, and an owner asking for another organization gets 404 organization_not_found. organization: organizationId, name, owner {name, email} and status. storage (the Storage Usage card): totalUsedGb, planQuotaGb (the one limit every organization shares, null until it is set), quotaPercent, status with statusLabel, images {gb, count, percentOfTotal} and files {gb, count, percentOfTotal} (PDFs, documents and records), measuredAt and unmeasured. categories (the Category Breakdown card): one entry each for residents (Resident Photos & Media), staff (Staff Profile Photos), floorPlans (PEEP & Floor Plans), documents (Documents, Signatures & Leave Attachments), family (Family Photos, Newsletters & Gazettes), visitors (Visitor Photos & Signatures) and profiles (Profile Pictures), each with label, gb, percentOfUsed, images {gb, count} and files {gb, count}; they add up to totalUsedGb. Show images.count for a photo category and files.count for a document category. branches (Sites & Operating Branches): one per branch, biggest first, with usedGb, images {gb, count} and files {gb, count}. billing (Billing & Pricing): planLimitGb, monthlyBaseGbp, overageGbpPerGb, status (withinPlan or overPlan) with label, overageGb and projectedOverageGbp (overageGb times the overage price). record: createdAt and updatedAt of the organization. GB are 1024 x 1024 x 1024 bytes, rounded to four decimals (4.5 MB is 0.0044 GB). The figures are the last nightly measurement, so a new organization shows 0 until it is first measured, which happens when the server starts. Add the query branchId to get the usage detail of one branch of that organization instead (click a branch row on the organization's branch list). A branch detail has scope {type: branch, branchId}, organization {organizationId, name, owner {name, email}, status}, branch {branchId, name, status} and the same storage, categories, billing and record sections for that branch only; planQuotaGb is the organization's shared limit, and branches is just that one. A branch that is not in the organization is 404 branch_not_found. The branch's category figures are filled by the next measurement after a restart or the nightly run; until then every category shows 0.",
  }),
];

const allSettingsRequests = [
  req("all settings", "GET", ["admin", "settings", "all"], {
    header: orgHeader,
    optional: {
      branchId: ["{{branchId}}", "The site for visits (an owner, super admin or platform admin picks one)"],
    },
    tests: [
      'pm.test("Settings fetched", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data).to.have.property("access");',
      "});",
    ],
    description: "All the settings in one call: billing {planLimitGb, baseTierGbp, overageGbpPerGb}, family {configured, gazette {issueEveryDays, messageCap, anchorDate}, updatedAt} and visits (the visiting rules of one site: branchId, timezone, visitingHours {start, end}, protectedTimes, daysAhead, maxPartySize, paused, pausedReason, pausedAt). access says which sections the caller may use: billing is for a platform admin only; family is for an owner or super admin of the organization; visits is for an owner, super admin, site manager, line manager or staff member who holds familyEngagement.view (an owner or super admin needs no stored permission). A section the caller may not use is left out, and so are family and visits when the Family Engagement module is off or no x-org-id is sent. A platform admin sends x-org-id only to also get family and visits. Query branchId picks the site for visits: an owner, super admin or platform admin must send it, and visits is null until they do; a site manager, line manager or staff member always gets their own site.",
  }),
  withBody(
    req("update all settings", "PUT", ["admin", "settings", "all"], {
      header: orgHeader,
      tests: [
        'pm.test("Settings saved", function () {',
        "    pm.response.to.have.status(200);",
        "});",
      ],
      description: "Saves any of the three sections in one call. Send only the sections you want to change, and inside a section only what changes. billing {planLimitGb (a number above 0 up to 1000000, or null to clear it), baseTierGbp and overageGbpPerGb (0 to 100000)}: platform admin only; it changes the one limit and prices every organization shares (400 invalid_plan_limit, invalid_billing_price or invalid_billing_settings). family {gazette {issueEveryDays 1-90, messageCap 1-100, anchorDate YYYY-MM-DD}}: owner or super admin; it changes the organization in x-org-id, and the first save needs anchorDate and switches the gazette schedule on. visits {branchId, visitingHours {start, end} (HH:mm, at least half an hour apart), protectedTimes [{start, end, label}], daysAhead 1-60, maxPartySize 1-20, paused, pausedReason}: needs familyEngagement.manage; it changes one site (400 invalid_visit_settings), and pausing cancels the visits still to come and tells the families. Every section is checked for access first and nothing is saved if any is refused (403 insufficient_role). Then the sections are saved in the order billing, family, visits, so a section that fails validation (400) stops the rest: sections before it are already saved. Returns the saved sections. 400 nothing_to_update when no section is sent, 400 invalid_settings_section when one is not an object.",
    }),
    {
      family: { gazette: { issueEveryDays: 14, messageCap: 30, anchorDate: "2026-10-01" } },
      visits: { branchId: "{{branchId}}", daysAhead: 14, maxPartySize: 6, paused: false },
    }
  ),
  withBody(
    req("update billing settings", "PUT", ["admin", "settings", "all"], {
      header: orgHeader,
      tests: [
        'pm.test("Billing settings saved", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.billing).to.have.keys("planLimitGb", "baseTierGbp", "overageGbpPerGb");',
        "});",
      ],
      description:
        "Billing & Usage settings, sent as the billing section of the all settings call. Platform admin only (403 insufficient_role for anyone else); an x-org-id is not needed. They are the one plan limit every organization shares and the prices on the Billing Readiness card. planLimitGb is a number above 0 up to 1000000, or null to clear it (400 invalid_plan_limit); baseTierGbp and overageGbpPerGb are numbers from 0 to 100000 (400 invalid_billing_price). Send only what changes; a billing section with none of the three is 400 invalid_billing_settings. Returns all three values. Read them with all settings.",
    }),
    { billing: { planLimitGb: 750, baseTierGbp: 380, overageGbpPerGb: 0.15 } }
  ),
];

const dashboardRequests = [
  req("super admin dashboard", "GET", ["admin", "platform", "dashboard"], {
    optional: {
      year: ["2026", "The year of the onboarding and data usage charts (the current year by default)"],
      organizationId: ["{{organizationId}}", "The organization shown in Organizational Overview (the one with the most modules by default)"],
    },
    tests: [
      'pm.test("Dashboard fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("summary", "onboardingGrowth", "topOrganizations", "organizationOverview", "dataUsage");',
      "});",
    ],
    description: "The Super Admin dashboard in one call. Platform admin only (Admin Login, no x-org-id): anyone else gets 403. Query: year (the year of the two charts, the current year by default; 400 invalid_statistics_year outside 2000 to 2100) and organizationId (the Select organization dropdown of Organizational Overview; the organization with the most modules by default; 404 organization_not_found). summary (the cards, over every organization): organizations, sites (branches), pendingInvitations (staff and owner invitations that are still pending and not expired), professionals (professional people records), siteAndLineManagers (active site and line manager memberships), staff (active staff profiles), residents (admitted) and totalMonthlyRevenueGbp (the Total Monthly Revenue card). onboardingGrowth (Onboarding Growth): year, months (Jan to Dec), organizations and sites (running totals at the end of each month; null for months still to come) and changePercent, the growth of organizations plus sites against a year ago (null when there were none then). topOrganizations (Top Organizations, five at most, most modules first): organizationId, name, status and modules (enabled modules that have not expired); organizations lists them all for the dropdown. revenueByOrganization (Revenue by Organization): organizationId, name and monthlyRevenueGbp for every organization. organizationOverview (the bars for the selected organization, null when there are none): organizationId, name, sites, staff, residents, modules, siteManagers and lineManagers. dataUsage (Data Usage & Images Shared): year, usedGb, planQuotaGb (the one plan limit times the number of organizations, null until the limit is set), quotaPercent, images and files {gb, percentOfUsed} and months, one per month with imagesGb, filesGb and totalGb. A past month shows what the nightly measurement recorded on its last run that month, so months before recording began are null; the current month shows today's numbers. Blank for now: totalMonthlyRevenueGbp and every monthlyRevenueGbp are null, because nothing stores revenue yet; the frontend shows them empty. Not included: Sites by Region, because nothing stores a branch's region.",
  }),
];

const ownerDashboardRequests = [
  req("owner dashboard", "GET", ["admin", "organizations", "{{organizationId}}", "dashboard"], {
    tests: [
      'pm.test("Dashboard fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("summary", "attendance", "leaveBreakdown", "staffByDepartment", "workforceOverview", "evacuationRisk", "activeModules", "fireDrills", "compliance", "staffTraining", "supervisionAppraisal", "openShifts");',
      "});",
    ],
    description: "The owner dashboard in one call. Owner or super admin of the organization in x-org-id (platform admin passes); site managers, line managers and staff get 403. No query. summary: totalStaff (active), totalResidents (admitted), todayVisitors (checked in today, denied left out), totalContractors, totalProfessionals. attendance: Mon to Sun (London time) of {day, present, absent}; present is staff with an attendance record, absent is staff on a shift that already started with none; days still to come are null. leaveBreakdown: this year's approved or closed leave as {label, percent} for Annual leave, Sick leave, Unpaid leave and Other. staffByDepartment: totalStaff and departments {name, count}, biggest first (staff with none are Unassigned). workforceOverview (this month, whole percents): attendance, training, retention, utilization; compliance and satisfaction are null. evacuationRisk: high, medium, low and notSet (admitted residents without a PEEP record). activeModules: active, total and modules {slug, name, active}. fireDrills: completed (closed mock evacuations this quarter) and overdueSites (no drill in 90 days). compliance: compliantPercent and items {name, compliantPercent} for competency requirements. staffTraining: the same for training requirements. Both use the requirement schema: an assigned requirement is met when its latest record has not expired, and staff are the active ones. supervisionAppraisal: compliantPercent (meetings done against meetings due so far, supervisions and appraisals together, using each staff member's own interval and start date), supervisions {pending (booked or due within 30 days), overdue (staff behind)} and appraisals {dueThisMonth, overdue}. openShifts: the five soonest upcoming open shifts {siteName, startsAt, endsAt, urgentCover}.",
  }),
];

const siteDashboardRequests = [
  req("site dashboard", "GET", ["admin", "organizations", "{{organizationId}}", "site-dashboard"], {
    optional: {
      people: ["all", "People on site now filter: all, staff, resident, visitor, contractor or professional"],
      period: ["thisMonth", "Visitor and contractor activity: thisWeek, thisMonth (default) or thisYear"],
    },
    tests: [
      'pm.test("Dashboard fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.include.keys("summary", "peopleOnSite", "activityFeed", "visitorAndContractorActivity", "compliance", "staffTraining", "supervisionAppraisal", "openShifts");',
      "});",
    ],
    description: "The site manager dashboard in one call. Site manager only, and always their own site; everyone else gets 403. Query: people (the People filter of People on site now: all, staff, resident, visitor, contractor or professional; 400 invalid_people_filter) and period (the Visitor and contractor activity dropdown: thisWeek, thisMonth, which is the default, or thisYear; 400 invalid_activity_period). summary (the cards): visitorsOnSite, staffOnSite, residentsPresent (admitted), pendingApprovals (visits waiting for approval), contractorsOnSite, professionalsOnSite and residentsOutOfHome (null because nothing stores it). peopleOnSite: total and the five latest check-ins {name, email, photoUrl, type (staff, resident, visitor, contractor or professional; All lists staff, visitors, contractors and professionals, residents only with the Residents filter), checkInAt, status (onSite or onBreak)}. activityFeed: the six latest events of the site (the same items as Site Live activity, View all uses site-live/activity). visitorAndContractorActivity (for the period): visitorVisits, contractorProfessionalVisits, averageVisitMinutes (null when no visit has checked out) and topReasons {reason, count}, three at most. compliance and staffTraining: compliantPercent for the site team and items {name, pending, dueAt} of competency and training requirements not yet met, the earliest due first, three at most. supervisionAppraisal: compliantPercent and items {type (supervision or appraisal), staffName, status (overdue, dueSoon or booked), dueAt (null when overdue)}, overdue first, three at most. openShifts: the site's upcoming open shifts, soonest first, five at most {startsAt, endsAt, urgentCover, openedAt}.",
  }),
];

adminFolder.item = adminFolder.item.filter((i) => !["Billing & Usage", "All Settings", "Super Admin Dashboard", "Owner Dashboard", "Site Manager Dashboard"].includes(i.name));
adminFolder.item.push({
  name: "Site Manager Dashboard",
  description: "The site manager home screen.",
  item: siteDashboardRequests,
});
adminFolder.item.push({
  name: "Owner Dashboard",
  description: "The owner home screen.",
  item: ownerDashboardRequests,
});
adminFolder.item.push({
  name: "Super Admin Dashboard",
  description: "The Super Admin home screen.",
  item: dashboardRequests,
});
adminFolder.item.push({
  name: "All Settings",
  description: "Billing, family and visit settings in one call.",
  item: allSettingsRequests,
});

adminFolder.item = adminFolder.item.filter((i) => i.name !== "Billing & Usage");
adminFolder.item.push({
  name: "Billing & Usage",
  description: "Storage used by each organization against one shared plan limit. Everyone sees the screen: a platform admin every organization, an owner their organization and its branches, a site manager, line manager or staff member their own branch. The pencil edits the organization (update organization, in the Organizations folder); only a platform admin changes the billing settings.",
  item: billingRequests,
});

// Which call sends which in-app notification (read them with GET /notifications).
const NOTIFIES = {
  "send join request": "New join request goes to the resident's next of kin and the site's site and line managers.",
  "approve join request": "Request approved goes to the person who asked.",
  "reject join request": "Request declined goes to the person who asked.",
  "request a visit": "New visit request goes to the site's site and line managers.",
  "invite family to a visit": "Visit invitation goes to the resident's active family.",
  "confirm visit request": "Visit confirmed goes to the person who asked.",
  "app approve visit request": "Visit confirmed goes to the person who asked.",
  "decline visit request": "Visit declined goes to the person who asked.",
  "app decline visit request": "Visit declined goes to the person who asked.",
  "cancel family visit": "Visit cancelled goes to the person who asked, or to the resident's family for a visit the home invited them to.",
  "cancel my visit": "Visit cancelled by family goes to the site's site and line managers.",
  "reply to visit invitation": "Invitation accepted or Can't make the visit goes to the site's site and line managers when the answer changes; repeating the same answer notifies nobody.",
  "send upload for approval": "New upload to review goes to the site's site and line managers.",
  "edit and resend upload": "New upload to review goes to the site's site and line managers when a Not Approved upload is sent again.",
  "deactivate family member": "Access paused goes to that member.",
  "remove family member": "Removed from family goes to that member; nothing is sent when they remove themselves.",
};
const noteNotifications = (item) => {
  if (item.item) return item.item.forEach(noteNotifications);
  const note = NOTIFIES[item.name];
  if (note && item.request && !(item.request.description || "").includes("Notification:"))
    item.request.description = `${item.request.description || ""} Notification: ${note}`;
};
noteNotifications(collection);

// ---------------------------------------------------------------- Notifications
// One top-level folder for both notification calls. The single request that used to sit under App > Settings moves here.
const dropOldNotifications = (node) => {
  if (!node.item) return;
  node.item = node.item.filter((i) => !(i.request && /\/(app\/)?notifications(\?|\/|$)/.test(i.request.url.raw || "")));
  node.item.forEach(dropOldNotifications);
};
collection.item.filter((i) => i.name !== "Notifications").forEach(dropOldNotifications);

const notificationRequests = [
  req("notifications", "GET", ["notifications"], {
    query: "page=1&limit=10",
    tests: [
      'pm.test("Notifications fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    if (json.data.length) { pm.collectionVariables.set("notificationId", json.data[0]._id); }',
      "});",
    ],
    description:
      "The signed-in user's notifications, newest first (a family token or a staff token). Query: page, limit. Each row has _id, type, title, body, objectType and objectId (what to open when it is tapped), subject (who caused it), isRead and timeSince. Family types: newMessage (objectId is the conversationId), familyNewPost, familyUploadApproved, familyUploadRejected, familyUploadPending, familyNewsletter, familyGazette, familyGazetteReminder, familyVisit (objectId is the visit), familyJoinRequest and familyAccess. In-app only: nothing is sent to the phone's notification tray. Sets notificationId.",
  }),
  req("notifications read", "PUT", ["notifications", "{{notificationId}}", "read"], {
    tests: [
      'pm.test("Notification marked read", function () {',
      "    pm.response.to.have.status(200);",
      '    pm.expect(pm.response.json().data.isRead).to.eql(true);',
      "});",
    ],
    description:
      "Marks one notification as read; no body. Use the notificationId saved by notifications. 404 notification_not_found for an unknown id.",
  }),
];

collection.item = collection.item.filter((i) => i.name !== "Notifications");
collection.item.push({
  name: "Notifications",
  description: "The notification list and marking a notification as read. Works with a family token or a staff token.",
  item: notificationRequests,
});

// Who decided a moderation request, shown on the queue and returned by the decision.
const DECIDER_NOTES = {
  "upload queue": " Each row also has decidedByName, decidedByRole (Owner, Site Manager, Line Manager or Staff) and decidedAt once it is decided; they are empty while it waits.",
  "approve upload": " The response has uploadId, status, decidedByName, decidedByRole and decidedAt.",
  "approve upload with blur": " The response has uploadId, status, decidedByName, decidedByRole and decidedAt.",
  "reject upload": " The response has uploadId, status, decidedByName, decidedByRole and decidedAt.",
};
const noteDecider = (item) => {
  if (item.item) return item.item.forEach(noteDecider);
  const note = DECIDER_NOTES[item.name];
  const description = (item.request && item.request.description) || "";
  if (note && /\/admin\//.test(item.request.url.raw || "") && !description.includes("decidedByRole"))
    item.request.description = `${description}${note}`;
};
noteDecider(collection);

const vars = collection.variable || [];
for (const key of ["familyCode", "joinRequestId", "memberId", "handoverId", "mediaId", "mediaIds", "uploadId", "postId", "newsletterId", "visitId", "visitDate", "visitTime", "familyVisitId", "conversationId", "broadcastId", "recipientId", "notificationId"]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value: "", type: "string" });
  }
}
if (!vars.find((v) => v.key === "relativeEmail")) {
  vars.push({ key: "relativeEmail", value: "relative@example.com", type: "string" });
}
collection.variable = vars;

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));
console.log("postman family access updated");

// requests are generated flat; this files them under their module folders
require("./organize-family-folders.js");
