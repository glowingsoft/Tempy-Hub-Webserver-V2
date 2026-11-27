const fs = require("fs");

const { collectionFile } = require("./collectionFile");
const FILE = collectionFile();
const source = fs.readFileSync(FILE, "utf8");
const collection = JSON.parse(source);

const appFolder = collection.item.find((i) => i.name === "App");
if (!appFolder) throw new Error("App folder not found");

const appChild = (name) => {
  const folder = appFolder.item.find((i) => i.name === name);
  if (!folder) throw new Error(`App > ${name} folder not found`);
  return folder;
};

const adminFolder = collection.item.find((i) => i.name === "Admin Panel");
const adminResidents = adminFolder?.item.find((i) => i.name === "Residents");
if (!adminResidents) throw new Error("Admin Panel > Residents folder not found");

const rememberToken = [
  "const jsonData = pm.response.json();",
  "if (jsonData.data && jsonData.data.acceptUrl) {",
  '    pm.collectionVariables.set("residentAccountInviteToken", jsonData.data.acceptUrl.split("/").pop());',
  "}",
];

const ok = [
  'pm.test("OK", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
];

const req = (
  name,
  method,
  pathParts,
  { body, tests = ok, orgScoped, noauth, description },
) => ({
  name,
  event: [
    { listen: "test", script: { type: "text/javascript", exec: tests } },
  ],
  request: {
    ...(noauth ? { auth: { type: "noauth" } } : {}),
    method,
    header: [
      ...(orgScoped ? [{ key: "x-org-id", value: "{{organizationId}}" }] : []),
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
      raw: `{{url}}/${pathParts.join("/")}`,
      host: ["{{url}}"],
      path: pathParts,
    },
    description,
  },
  response: [],
});

const staffRequests = [
  req(
    "send resident account invitation",
    "POST",
    ["app", "residents", "{{residentId}}", "account-invitation"],
    {
      orgScoped: true,
      body: { email: "{{residentAccountEmail}}" },
      tests: [...ok, "", ...rememberToken],
      description:
        "Resident screen, profile tab. Sends the invite, or resends it when one is pending (new link, old link stops working). email is optional when a pending invite or the resident record already has one. Returns account { status, email, invitedAt, expiresAt } and acceptUrl. 409: resident_not_admitted, resident_account_already_linked, email_used_by_staff, email_used_by_family_member, email_used_by_another_resident, invitation_already_pending.",
    },
  ),
  req(
    "remove resident account access",
    "DELETE",
    ["app", "residents", "{{residentId}}", "account"],
    {
      orgScoped: true,
      description:
        "Revokes a pending invite and unlinks the resident login. 404 resident_account_not_found when there is neither.",
    },
  ),
];

const authRequests = [
  req(
    "preview resident account invitation",
    "GET",
    ["auth", "visitor-account-invitations", "{{residentAccountInviteToken}}"],
    {
      noauth: true,
      description:
        "Same endpoint as visitor account invitations. For a resident, personType is resident and residentId is included.",
    },
  ),
  req(
    "accept resident account invitation",
    "POST",
    [
      "auth",
      "visitor-account-invitations",
      "{{residentAccountInviteToken}}",
      "accept",
    ],
    {
      noauth: true,
      body: { password: "{{password}}", timezone: "Europe/London" },
      description:
        "Creates the account, or keeps the password when the email already has a non-staff user, and links Resident.userId. Returns userId, email, residentId and personType.",
    },
  ),
  req("Login Resident", "POST", ["auth", "login"], {
    noauth: true,
    body: {
      email: "{{residentAccountEmail}}",
      password: "{{password}}",
      deviceType: "android",
      deviceId: "1234",
      timezone: "Europe/London",
      audience: "resident",
    },
    tests: [
      'pm.test("Resident login", function () {',
      "    pm.response.to.have.status(200);",
      "    var jsonData = pm.response.json();",
      "    if (jsonData.data && jsonData.data.token) {",
      '        pm.collectionVariables.set("token", jsonData.data.token);',
      "    }",
      "});",
    ],
    description:
      "audience=resident is required; without it the account gets a family token. Works only while the resident is admitted and linked. access.resident holds residentId, name, photoUrl, roomNumber, organization and branch.",
  }),
];

const upsert = (folder, requests) => {
  for (const request of requests) {
    const idx = folder.item.findIndex((r) => r.name === request.name);
    if (idx >= 0) folder.item[idx] = request;
    else folder.item.push(request);
  }
};

adminResidents.item = adminResidents.item.filter(
  (r) => r.name !== "create resident with account invitation",
);
const createRequest = adminResidents.item.find(
  (r) => r.name === "create resident",
);
if (!createRequest) throw new Error("create resident request not found");

createRequest.request.body.raw = JSON.stringify(
  {
    name: "James Taylor",
    roomNumber: "106",
    branchId: "{{branchId}}",
    email: "{{residentAccountEmail}}",
    phone: "+447700900001",
    careLevel: "low",
    admissionStatus: "admitted",
    photographyConsent: true,
    visitorPasscode: "1098",
  },
  null,
  2,
);
createRequest.request.description =
  "Creates the resident and always sends the account invitation. email is required and admissionStatus must be admitted. Nothing is created when the invite cannot be sent: 400 for a missing or invalid email, 409 resident_not_admitted, email_used_by_staff, email_used_by_another_resident or invitation_already_pending. The response is the resident plus account { status, email, invitedAt, expiresAt } and acceptUrl. photographyConsent (true or false) records whether photos of the resident may be shared with families; it is what allows photos in family uploads and wall-post tags. Leave it out and it is off. visitorPasscode is optional, 4 to 32 digits.";
const createTest = createRequest.event.find((e) => e.listen === "test");
if (!createTest.script.exec.some((l) => l.includes("residentAccountInviteToken"))) {
  createTest.script.exec.push(
    "if (json.data && json.data.acceptUrl) {",
    '    pm.collectionVariables.set("residentAccountInviteToken", json.data.acceptUrl.split("/").pop());',
    "}",
  );
}
upsert(appChild("Residents & People"), staffRequests);
upsert(appChild("Auth"), authRequests);

let residentApp = appFolder.item.find((i) => i.name === "Resident App");
if (!residentApp) {
  residentApp = { name: "Resident App", item: [] };
  appFolder.item.push(residentApp);
}
upsert(residentApp, [
  req("my family screen", "GET", ["app", "resident", "family"], {
    description:
      "Resident app Family tab in one call. Run Login Resident first. Returns resident { name, photoUrl, homeName }, family { count, members, note } with active members and the next of kin first, gazette { gazetteId, issueNumber, messageCount } for the latest printed gazette or null, and photos { newCount }: photos from family uploads approved since the resident last opened My Photos. Family and gazette are empty when Family Engagement is off; newCount counts only photos shared while consent was on. 403 wrong_token_audience for a non-resident token, resident_profile_not_found when the resident is discharged or unlinked.",
  }),
]);

upsert(residentApp, [
  {
    ...req("my photos screen", "GET", ["app", "resident", "photos"], {
      description:
        "Resident app My Photos screen in one call. Run Login Resident first. Query: tab (all, family or home; default all), page, limit. Returns subtitle, photoSharing, tab, tabs (home is labelled with the branch name) and photos { mediaId, url, width, height, source, title, fromName, sharedAt, isLatest }, newest first, with pagination in meta. family is approved family uploads; home is published wall posts that tag the resident. Loading page 1 marks the photos as seen, which resets newCount on the family screen. photoSharing says whether sharing is on; when it is off, photos shared before it was turned off are still listed. photos is empty if the resident never shared or Family Engagement is off. 400 invalid_gallery_tab.",
    }),
  },
]);
const photosRequest = residentApp.item.find((r) => r.name === "my photos screen");
photosRequest.request.url = {
  raw: "{{url}}/app/resident/photos?tab=all&page=1&limit=20",
  host: ["{{url}}"],
  path: ["app", "resident", "photos"],
  query: [
    { key: "tab", value: "all" },
    { key: "page", value: "1" },
    { key: "limit", value: "20" },
  ],
};

photosRequest.event[0].script.exec = [
  ...ok,
  "const jsonData = pm.response.json();",
  "if (jsonData.data && jsonData.data.photos && jsonData.data.photos.length) {",
  '    pm.collectionVariables.set("residentPhotoId", jsonData.data.photos[0].mediaId);',
  "}",
];

upsert(residentApp, [
  req("photo screen", "GET", ["app", "resident", "photos", "{{residentPhotoId}}"], {
    tests: [
      ...ok,
      "const jsonData = pm.response.json();",
      "if (jsonData.data && jsonData.data.nextMediaId) {",
      '    pm.collectionVariables.set("residentPhotoId", jsonData.data.nextMediaId);',
      "}",
    ],
    description:
      "Resident app single photo screen. Run my photos screen first; it saves residentPhotoId. Query: tab (all, family or home; default all), the same tab the photo was opened from. Returns tab, photo { mediaId, url, width, height, source, title, fromName, sharedAt }, position, total, previousMediaId (newer photo) and nextMediaId (older photo), each null at the ends. Sending again moves to the next photo. 404 resident_media_not_found when the photo is not shared with this resident or is not in the tab; 400 invalid_gallery_tab.",
  }),
]);

upsert(residentApp, [
  req("my gazette screen", "GET", ["app", "resident", "gazette"], {
    description:
      "Resident app My Gazette screen: the latest printed gazette, with the same response as the family app's get gazette (GET /app/family/gazettes/:gazetteId): gazetteId, title, issueNumber, periodStart, periodEnd, periodLabel, residentName, homeName, pageCount, printedAt, givenAt, cover, messages and life. Optional page and limit slice messages and add meta, as there. 404 gazette_not_found when nothing is printed or Family Engagement is off.",
  }),
]);

upsert(residentApp, [
  req("visitors screen", "GET", ["app", "resident", "visitors"], {
    description:
      "Resident app Visitors tab in one call. Query: page, limit for recent visitors. Returns resident { name, photoUrl, homeName }, hereNow { count, visitors } (signed in and not signed out, earliest arrival first) and recentVisitors (signed out, one row per person, latest first), with meta paging recentVisitors. Each visitor uses the Site Manager people row fields (_id (the visit), personKind, personId, branchId, name, photoUrl, category, method, visitPurpose, hostName, signedInAt) plus role (family relationship, else visitor category, else visitor type), isFamily and subtitle; recentVisitors adds signedOutAt. Lists visits recorded against this resident, visits checked in from an invitation for this resident, and visits by the resident's active family members at the home unless recorded against another resident. Nurses, contractors and other non-family visitors appear when residentId is sent on kiosk walk-in check-in, admin check-in or admin visitor invitation.",
  }),
]);

upsert(residentApp, [
  req("past gazettes screen", "GET", ["app", "resident", "gazettes"], {
    tests: [
      ...ok,
      "const jsonData = pm.response.json();",
      "if (jsonData.data && jsonData.data.length) {",
      '    pm.collectionVariables.set("residentGazetteId", jsonData.data[0].gazetteId);',
      "}",
    ],
    description:
      "Resident app past gazettes list, with the same response as the family app's list (GET /app/family/gazettes): gazetteId, issueNumber, periodStart, periodEnd, periodLabel, title, residentName, residentPhotoUrl, coverUrl, messageCount, pageCount, printedAt, givenAt and latest, printed gazettes newest first, with meta. Query: page, limit. Empty when Family Engagement is off. Saves residentGazetteId.",
  }),
  req(
    "gazette detail screen",
    "GET",
    ["app", "resident", "gazettes", "{{residentGazetteId}}"],
    {
      description:
        "Resident app gazette detail, with the same response as the family app's get gazette. Run past gazettes screen first. Optional page and limit slice messages and add meta. 404 gazette_not_found when it is not this resident's printed gazette or Family Engagement is off.",
    },
  ),
]);

const residentIdNote =
  " Optional residentId records which resident is being visited, so the visit shows on that resident's Visitors screen; the resident must be admitted at this branch (404 resident_not_found). On an invitation it carries through to check-in.";
const takesResidentId = (url) =>
  /\/kiosk\/visits\/check-in$/.test(url) ||
  /\/visit-sessions\/check-in$/.test(url) ||
  /admin\/organizations\/[^/]+\/visitor-invitations$/.test(url);
const addResidentIdNote = (items) => {
  for (const item of items) {
    if (item.item) {
      addResidentIdNote(item.item);
      continue;
    }
    const request = item.request;
    if (!request || request.method !== "POST") continue;
    const url = String(request.url?.raw || "").split("?")[0];
    if (!takesResidentId(url)) continue;
    const description = String(request.description || "");
    if (!description.includes(residentIdNote.trim())) {
      request.description = `${description}${residentIdNote}`.trim();
    }
  }
};
addResidentIdNote(collection.item);

const evacuationAnswer = (name, status, description) =>
  req(name, "POST", ["app", "evacuations", "me", "check"], {
    body: { status },
    description,
  });

upsert(residentApp, [
  evacuationAnswer(
    "evacuation I am OK",
    "safe",
    "Resident app fire drill button. Same URL as the staff self check; run Login Resident first. Records residentResponse ok on the resident's own roll call entry. status stays as staff set it, so the resident stays unaccounted until staff confirm. 404 no_active_evacuation, 403 module_not_enabled, 400 invalid_evac_check_status.",
  ),
  evacuationAnswer(
    "evacuation I need help",
    "needHelp",
    "Resident app fire drill button. Records residentResponse needHelp, leaves status unchanged and alerts all active staff at the home plus owners. The same answer repeated within a minute is ignored.",
  ),
]);

upsert(residentApp, [
  req("home screen", "GET", ["app", "resident", "home"], {
    description:
      "Resident app Home tab in one call. Run Login Resident first. Returns resident { name, photoUrl, homeName }, status { isOut, label, destination, since, expectedReturnAt }, photos { newCount }, newsletter { newsletterId, title, month, issueNumber, sentAt, subtitle, isNew } for the home's latest in-app newsletter or null, and evacuation { evacuationEventId, type (mock or real), title, startedAt, assemblyPoint, checkStatus, residentResponse, residentRespondedAt } while a drill or fire is active at the home, otherwise null. Answer it with POST /app/evacuations/me/check. Photos and newsletter are empty when Family Engagement is off; evacuation is null when that module is off.",
  }),
]);

upsert(residentApp, [
  req("newsletter screen", "GET", ["app", "resident", "newsletter"], {
    description:
      "Resident app newsletter screen: the home's latest in-app newsletter, with the same response as the family app's get newsletter (GET /app/family/newsletters/:newsletterId): newsletterId, homeName, title, month, periodLabel, issueNumber, sentAt, editedAt, welcome, highlights, comingUp, notices, newResidents, gallery and footer; sections switched off are empty. Optional page and limit slice highlights and add meta. Opening it marks the newsletter as read, so isNew on the home screen turns false. 404 newsletter_not_found when none has been sent or Family Engagement is off.",
  }),
]);

upsert(residentApp, [
  {
    ...req("community wall screen", "GET", ["app", "resident", "wall"], {
      description:
        "Resident app Community Wall, with the same response as the family app's wall (GET /app/family/wall): published posts { postId, branchId, homeName, authorName, authorPhotoUrl, title, message, photos [{ mediaId, url }], taggedResidents, audience, isPinned, isPinnedByMe, reactionCount, reactedByMe, createdAt }, pinned first then newest, with meta. Query: page, limit. Shows the home's posts, posts for everyone and posts that tag this resident; only this resident is named in taggedResidents. Empty when Family Engagement is off.",
    }),
  },
]);
const wallRequest = residentApp.item.find((r) => r.name === "community wall screen");
wallRequest.request.url = {
  raw: "{{url}}/app/resident/wall?page=1&limit=10",
  host: ["{{url}}"],
  path: ["app", "resident", "wall"],
  query: [
    { key: "page", value: "1" },
    { key: "limit", value: "10" },
  ],
};

upsert(residentApp, [
  req("my profile screen", "GET", ["app", "resident", "profile"], {
    description:
      "Resident app My Profile. Returns resident { residentId, name, photoUrl, homeName, roomNumber, subtitle }, details { familyContact { memberId, name, photoUrl, relationship, label } } and settings { largeText, soundAlerts, sharePhotos }. familyContact is the active next of kin, null when there is none or Family Engagement is off.",
  }),
  req("my profile settings", "PATCH", ["app", "resident", "profile"], {
    body: { largeText: false, soundAlerts: true, sharePhotos: true },
    description:
      "Saves one or more settings; send only what changed. Each must be true or false. sharePhotos is the resident's photography consent, recorded with the time and the resident as recorder; turning it off stops new photos being shared, and photos shared before then stay visible. Returns the same body as my profile screen. 400 invalid_resident_setting or nothing_to_update. Sign out uses POST /auth/logout with deviceId.",
  }),
  req("resident sign out", "POST", ["auth", "logout"], {
    body: { deviceId: "1234" },
    description:
      "Shared logout. Removes this device from push notifications for the account. The app must also discard the token.",
  }),
]);

const vars = collection.variable || [];
for (const [key, value] of [
  ["residentAccountEmail", "resident.postman@example.com"],
  ["residentAccountInviteToken", ""],
  ["residentPhotoId", ""],
  ["residentGazetteId", ""],
]) {
  if (!vars.find((v) => v.key === key)) {
    vars.push({ key, value, type: "string" });
  }
}
collection.variable = vars;

const output = JSON.stringify(collection, null, 2);
fs.writeFileSync(
  FILE,
  source.includes("\r\n") ? output.replace(/\n/g, "\r\n") : output,
);
console.log("postman resident account requests updated", FILE);
