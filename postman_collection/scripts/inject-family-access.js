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

const req = (name, method, pathParts, { query, tests, description, header } = {}) => ({
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
        '    pm.expect(data.status).to.eql("waiting");',
        '    pm.collectionVariables.set("uploadId", data.uploadId);',
        "});",
      ],
      description:
        "New Upload: Send For Approval. Body: residentId, message (up to 500 characters), mediaIds (up to 10, from upload photo), includeInGazette, clientId. Needs a message or a photo. 400 photos_cannot_be_shared when the resident has photo sharing off (a message alone is allowed); 400 for too many photos, a message over 500 characters or photos that are not yours; 404 for a resident you are not linked to. The same clientId returns the upload already made. Saved as waiting; nobody but you sees it until a manager approves.",
    }),
    {
      residentId: "{{residentId}}",
      message: "Lily scored twice at her first football match!",
      mediaIds: ["{{mediaId}}"],
      includeInGazette: true,
      clientId: "postman-upload-1",
    }
  ),
  req("my uploads", "GET", ["app", "family", "uploads"], {
    query: "page=1&limit=10",
    tests: [
      'pm.test("My uploads fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("waiting", "approved", "rejected");',
      "});",
    ],
    description:
      "My Uploads: Approved, Waiting For Approval and Not Approved (with rejectionReason). Optional query: status (waiting, approved, rejected), residentId, page, limit. meta.counts has the three totals and ignores the status filter. Photos show the blurred copy once one exists. Rejected uploads disappear 30 days after rejection.",
  }),
  withBody(
    req("edit and resend upload", "PUT", ["app", "family", "uploads", "{{uploadId}}"], {
      tests: [
        'pm.test("Upload resent", function () {',
        "    pm.response.to.have.status(200);",
        '    pm.expect(pm.response.json().data.status).to.eql("waiting");',
        "});",
      ],
      description:
        "My Uploads: Edit And Resend. Body (all optional): message, mediaIds, includeInGazette. A waiting or not approved upload returns to waiting with the reason cleared. 409 upload_not_editable once approved; 404 for someone else's upload or after you were removed from the family.",
    }),
    { message: "Lily scored twice at her first football match, Gran!", includeInGazette: true }
  )
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
      "Home Family Tab, Family: everything shared about the resident, newest first. Query: residentId (required), page, limit (default 20, max 50). Approved uploads from any family member only; waiting and rejected ones never appear. Each item has type, authorName, authorPhotoUrl, authorRelationship, message, photos (the blurred copy where one exists) and publishedAt (when it was approved). 404 if you are not linked to the resident or the module is off.",
  })
);

// ---------------------------------------------------------------- Community wall (family app)
requests.push(
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
  req("wall posts", "GET", ["admin", "organizations", "{{organizationId}}", "family-posts"], {
    query: "page=1&limit=10",
    tests: [
      'pm.test("Wall posts fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("published", "removed");',
      "});",
    ],
    description:
      "Staff Community Wall: every post of the organization, pinned first then newest, with author, home, photos, all tagged residents and reactionCount. Optional query: status (published or removed), branchId, residentId (tagged), keyword, page, limit. meta.counts has published and removed and ignores the status filter. Needs familyEngagement.view; 404 when the module is off.",
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
  req("upload queue", "GET", ["admin", "organizations", "{{organizationId}}", "family-uploads"], {
    query: "page=1&limit=10",
    tests: [
      'pm.test("Upload queue fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    const json = pm.response.json();",
      '    pm.expect(json.data).to.be.an("array");',
      '    pm.expect(json.meta.counts).to.have.all.keys("waiting", "approved", "rejected");',
      "});",
    ],
    description:
      "Moderation queue: uploads waiting for approval, oldest first, with author, resident, room and the original photos. Optional query: status (default waiting), branchId, residentId, page, limit. meta.counts has waiting, approved and rejected for the tabs and ignores the status filter. Needs familyEngagement.view; 404 when the module is off.",
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
      "Family member detail: name, email, phone, photo, relationship, isNextOfKin, status and joinedVia; the resident, room and home; familySize; uploads (waiting, approved, rejected for this resident); and when they joined, who approved them and who removed them. A removed member can still be opened. memberId comes from the family members list. 404 for another organization's member. Needs familyEngagement.view; 404 when the module is off.",
  }),
  req("family groups", "GET", ["admin", "organizations", "{{organizationId}}", "family-groups"], {
    query: "page=1&limit=10",
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
    tests: [
      'pm.test("All family members fetched", function () {',
      "    pm.response.to.have.status(200);",
      "    pm.expect(pm.response.json().data).to.be.an(\"array\");",
      "});",
    ],
    description:
      "Every active and pending family member of the organization in the path, across residents, whoever invited them. Same shape as the organization members list. Owners, super admins and managers with familyEngagement.view; 404 when the module is off. Without a status it lists active and pending. meta.counts gives the number of active, pending, rejected, cancelled and removed members; the counts ignore the status filter. Optional query: branchId, residentId, status, isNextOfKin, page, limit.",
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
      "Approves a waiting upload; the author is notified. Body: action approve. Needs familyEngagement.approve (a line manager only if granted) and, for site and line managers, an upload on their own site. 409 upload_already_decided (with the status) when another manager decided first.",
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
      "Rejects a waiting upload. Body: action reject and reason (required, up to 500 characters). The author sees the reason under Not Approved and is notified; the upload is removed 30 days later.",
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
      message: "Garden afternoon: live music and scones on the lawn.",
      mediaIds: ["{{mediaId}}"],
      taggedResidentIds: ["{{residentId}}"],
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
      "Staff Community Wall: new post. Body: branchId (an owner or super admin must pick the site; a site or line manager posts to their own), message (up to 2000 characters), mediaIds (up to 10, from upload post photo), taggedResidentIds (up to 50, only residents of that site with photo sharing on, from taggable residents) and isPinned. Needs text or a photo. Goes live straight away with no approval and every active family member at the site gets a notification. 400 residents_cannot_be_tagged for a resident with photo sharing off or at another site. Needs familyEngagement.manage.",
  },
  {
    name: "update post",
    method: "PUT",
    path: ["admin", "family", "posts", "{{postId}}"],
    body: { message: "Garden afternoon: live music, scones and a raffle.", isPinned: true },
    tests: [
      'pm.test("Post updated", function () {',
      "    pm.response.to.have.status(200);",
      "});",
    ],
    description:
      "Edit the text, photos or tags, or pin and unpin. Anything not sent stays as it was. Same checks as create. A site or line manager can only change their own site's posts. Families are not notified again.",
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
const familyInvitationItems = (adminFolder.item.find((i) => i.name === "Family Invitations") || { item: [] }).item;
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
    "Family invitation detail: name, email, phone, relationship, isNextOfKin, status (a pending one past its expiry reads as expired), the resident, room and home, who invited, createdAt, expiresAt, lastSentAt, sendCount, and who accepted or revoked it. The token hash is never returned. 404 for another organization's invitation. Needs familyEngagement.view; 404 when the module is off.";
}
if (allInvitations) {
  const path = ["admin", "organizations", "{{organizationId}}", "family-invitations"];
  allInvitations.request.url.path = path;
  allInvitations.request.url.raw = `{{url}}/${path.join("/")}?page=1&limit=10&status=pending`;
  allInvitations.request.url.query = [
    { key: "page", value: "1" },
    { key: "limit", value: "10" },
    { key: "status", value: "pending" },
  ];
  allInvitations.request.header = (allInvitations.request.header || []).filter(
    (h) => String(h.key).toLowerCase() !== "x-org-id"
  );
  allInvitations.request.description =
    "Every family invitation of the organization in the path, whoever sent it, newest first. Same shape as the organization invitations list. Owners, super admins and managers with familyEngagement.view; 404 when the module is off. Optional query: branchId, status, residentId, keyword, page, limit. Rows carry residentName and invitedByName. meta.counts gives the number of pending, accepted, revoked and expired invitations (a pending one past its expiry counts as expired); the counts ignore the status filter.";
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

const vars = collection.variable || [];
for (const key of ["familyCode", "joinRequestId", "memberId", "handoverId", "mediaId", "mediaIds", "uploadId", "postId"]) {
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
