const fs = require("fs");

const FILE = "./postman_collection/Tempy Hub API_13_10_2026.postman_collection.json";
const collection = JSON.parse(fs.readFileSync(FILE, "utf8"));

const side = (name) => {
  const folder = collection.item.find((i) => i.name === name);
  if (!folder) throw new Error(`${name} folder not found`);
  return folder;
};
const isFolder = (item) => Array.isArray(item.item);
const folder = (name, description, item) => ({ name, description, item });

/** Every request under a folder, wherever it sits. */
const requestsIn = (item) => (isFolder(item) ? item.item.flatMap(requestsIn) : [item]);

/**
 * Requests are matched by name. Ones already organised are read first and the loose ones the
 * generator scripts add are read last, so a freshly generated request replaces an older copy.
 */
const collect = (organised, loose) => {
  const byName = new Map();
  organised.flatMap(requestsIn).forEach((request) => byName.set(request.name, request));
  loose.flatMap(requestsIn).forEach((request) => byName.set(request.name, request));
  return byName;
};

const place = (byName, names, used) =>
  names.map((name) => {
    const request = byName.get(name);
    if (!request) throw new Error(`request not found: ${name}`);
    used.add(name);
    return request;
  });

// ---------------------------------------------------------------- Admin Panel
const admin = side("Admin Panel");
const adminOld = ["Family Invitations", "Family Management"];
const adminRoot = "Family Engagement";
const adminSources = admin.item.filter((i) => [...adminOld, adminRoot].includes(i.name));
const adminAt = Math.min(...adminSources.map((i) => admin.item.indexOf(i)));
const adminRequests = collect(
  adminSources.filter((i) => i.name === adminRoot),
  adminSources.filter((i) => adminOld.includes(i.name))
);
const adminUsed = new Set();
const adminPlace = (...names) => place(adminRequests, names, adminUsed);

const familyEngagement = folder(adminRoot, "Staff side of the family module, one folder per screen.", [
  folder("Overview", "The Family overview screen: cards, family activity and the checklist before the issue closes.", adminPlace(
    "family overview"
  )),
  folder("Moderation", "Uploads families send, waiting for a manager to approve, blur or reject.", adminPlace(
    "upload photo for approval", "upload photos for approval", "send upload for approval (staff)", "upload queue", "approve upload", "approve upload with blur", "reject upload"
  )),
  folder("Community Wall", "Staff wall posts, with photos and tagged residents.", adminPlace(
    "wall posts", "post authors", "dismiss post reports", "taggable residents", "upload post photo", "upload post photos", "create post", "update post", "remove post"
  )),
  folder("Newsletters", "Monthly newsletters for a site: build the draft, edit every section, send.", adminPlace(
    "newsletters", "newsletter detail", "newsletter pdf", "create newsletter", "update newsletter", "send newsletter", "schedule newsletter", "cancel newsletter schedule", "remove newsletter"
  )),
  folder("Gazettes", "Build, check, fix and print each resident's gazette.", adminPlace(
    "gazettes", "gazette detail", "gazette pdf", "download all gazette pdfs", "generate gazettes", "regenerate gazette",
    "mark gazette printed", "mark gazette given", "mark all gazettes printed", "retry failed gazettes"
  )),
  folder("Visits", "Visit requests and invitations, and what a site offers on Book A Visit.", adminPlace("family visits", "invite family to a visit", "confirm visit request", "decline visit request", "cancel family visit")),
  folder("Family Groups", "One row per resident with their family.", adminPlace("family groups", "family group detail")),
  folder("Family Membership", "Who is in each family, and how they get in.", [
    folder("Family Invitations", "Invite a family member, and follow the invitations.", adminPlace(
      "invite family member", "list family invitations", "get family invitation", "edit family invitation", "resend family invitation", "revoke family invitation", "delete family invitation"
    )),
    folder("Family Members", "Members, next of kin, family codes, join requests and handovers.", adminPlace(
      "family relationship options", "all family members", "family member detail", "family members", "update family member", "deactivate family member", "activate family member", "set next of kin", "remove family member",
      "current family code", "make family code", "join requests", "approve join request", "reject join request", "open handovers"
    )),
  ]),
]);

const adminLeftovers = [...adminRequests.keys()].filter((name) => !adminUsed.has(name));
familyEngagement.item.push(...adminLeftovers.map((name) => adminRequests.get(name)));
admin.item = admin.item.filter((i) => !adminSources.includes(i));
admin.item.splice(Math.min(adminAt, admin.item.length), 0, familyEngagement);

// ---------------------------------------------------------------- App
const app = side("App");
const appFamily = app.item.find((i) => i.name === "Family");
const appInvitations = app.item.find((i) => i.name === "Family Invitations");
const appRequests = collect(
  appFamily ? appFamily.item.filter(isFolder) : [],
  [...(appFamily ? appFamily.item.filter((i) => !isFolder(i)) : []), ...(appInvitations ? [appInvitations] : [])]
);
const appUsed = new Set();
const appPlace = (...names) => place(appRequests, names, appUsed);

const family = folder("Family", "The family app: what a family member and the next of kin do.", [
  folder("Family Membership", "Joining a family, the family code, members and handover.", [
    folder("Family Invitations", "Invitations to join a family, and the ones the next of kin sent.", appPlace(
      "list my family invitations", "get my family invitation", "accept my family invitation", "invite a relative", "invitations I sent"
    )),
    folder("Family Members", "Residents, members, family code, join requests and handover.", appPlace(
      "relationship options", "my residents", "my family", "remove family member", "leave family",
      "current family code", "make new family code", "check family code", "send join request", "current join request",
      "cancel join request", "join requests to review", "approve join request", "reject join request",
      "handover candidates", "ask to take over", "ask the home to choose", "current handover",
      "accept handover", "decline handover", "cancel handover"
    )),
  ]),
  folder("Moderation", "A family member's own uploads, from photo to approval.", appPlace(
    "upload photo", "upload photos", "send upload for approval", "my uploads", "edit and resend upload", "delete my upload"
  )),
  folder("Gazette", "The gazette being collected, the printed ones and the reader.", appPlace("next gazette", "printed gazettes", "read gazette", "download gazette pdf")),
  folder("Home", "The Home Family tab in one call: greeting, next visit, gazette due, notices and unread counts.", appPlace("home")),
  folder("Timeline", "Everything shared about the resident.", appPlace("timeline")),
  folder("Gallery", "The resident's photos: All, This Month and From Me.", appPlace("gallery")),
  folder("Visits", "My Visits, Book A Visit and the Visit Pass.", appPlace("my visits", "next visit", "visit options", "request a visit", "cancel my visit", "reply to visit invitation", "visit pass", "update visit pass")),
  folder("Newsletters", "Current and past newsletters of the home: list, read and PDF.", appPlace("newsletters of my home", "read newsletter", "download newsletter pdf")),
  folder("Community Wall", "The home's wall: read it and react.", appPlace("community wall", "react to post", "remove reaction", "mark posts seen", "report post")),
]);

const appLeftovers = [...appRequests.keys()].filter((name) => !appUsed.has(name));
family.item.push(...appLeftovers.map((name) => appRequests.get(name)));

const appAt = Math.min(...[appFamily, appInvitations].filter(Boolean).map((i) => app.item.indexOf(i)));
app.item = app.item.filter((i) => i !== appFamily && i !== appInvitations);
app.item.splice(Math.min(appAt, app.item.length), 0, family);

fs.writeFileSync(FILE, JSON.stringify(collection, null, 2));

const total = (item) => requestsIn(item).length;
console.log(`family folders organised: ${total(familyEngagement)} admin requests, ${total(family)} app requests`);
[...adminLeftovers, ...appLeftovers].forEach((name) => console.log(`not in a module folder yet: ${name}`));
