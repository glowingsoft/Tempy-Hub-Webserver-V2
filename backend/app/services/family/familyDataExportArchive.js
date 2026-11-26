const yazl = require("yazl");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyVisit } = require("@models/FamilyVisit");
const { FamilyMemberStatus } = require("@models/domainEnums");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const Message = require("../../../commonModules/chatModule/models/Message");
const familyPreferenceService = require("./familyPreferenceService");
const { toObjectId } = require("./familyPipeline");

/**
 * What goes into "Download My Data". Included: the person's own name and contact details, their
 * family memberships and settings, the photos and messages they sent, and their visits.
 * Left out: other family members, other residents, staff, and the home's own records.
 */

// a resident is only ever named to someone whose link to them was approved
const APPROVED_ONCE = new Set([
  FamilyMemberStatus.ACTIVE,
  FamilyMemberStatus.INACTIVE,
  FamilyMemberStatus.REMOVED,
]);

const namesById = async (model, ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await model
    .find({ _id: { $in: unique } })
    .select("name")
    .lean();
  return new Map(rows.map((row) => [String(row._id), row.name || ""]));
};

const loadRows = async (userId) => {
  const id = toObjectId(userId);
  const [user, links, uploads, visits, messages] = await Promise.all([
    User.findById(id).select("name email phoneNumber createdAt").lean(),
    FamilyMember.find({ userId: id }).sort({ createdAt: 1 }).lean(),
    FamilyUpload.find({ authorId: id }).sort({ createdAt: 1 }).lean(),
    FamilyVisit.find({ $or: [{ requestedBy: id }, { "replies.userId": id }] })
      .sort({ startAt: 1 })
      .lean(),
    Message.find({ senderId: id }).sort({ createdAt: 1 }).lean(),
  ]);
  return { user, links, uploads, visits, messages };
};

// the blurred copy is what the app shows its author, and it hides anyone who must not be seen
const photoKey = (media) => media.blurredKey || media.storageKey;

const isMissingObject = (error) =>
  error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;

/** Adds each photo to the zip and returns what each upload's entry should list. */
const addPhotos = async (zip, uploads) => {
  const mediaIds = uploads.flatMap((upload) => upload.mediaIds || []);
  const media = mediaIds.length
    ? await FamilyMedia.find({ _id: { $in: mediaIds } })
        .select("storageKey blurredKey")
        .lean()
    : [];
  const mediaById = new Map(media.map((row) => [String(row._id), row]));
  const listed = new Map();

  for (const [index, upload] of uploads.entries()) {
    const photos = [];
    for (const [position, mediaId] of (upload.mediaIds || []).entries()) {
      const row = mediaById.get(String(mediaId));
      const name = `photos/upload-${index + 1}-photo-${position + 1}.jpg`;
      if (!row) continue;
      try {
        const body = await uploadAwsService.getObject(photoKey(row));
        zip.addBuffer(body, name, { compress: false });
        photos.push(name);
      } catch (error) {
        // a photo that no longer exists is reported; anything else fails the build so it is retried
        if (!isMissingObject(error)) throw error;
        photos.push(`${name} (no longer available)`);
      }
    }
    listed.set(String(upload._id), photos);
  }
  return listed;
};

const toBuffer = (zip) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    zip.outputStream
      .on("data", (chunk) => chunks.push(chunk))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
    zip.end();
  });

const README = [
  "Your Tempy Hub data",
  "",
  "my-data.json holds your details, family memberships, notification settings,",
  "the photos and messages you sent (with their status) and your visits.",
  "The photos folder holds the photos you sent.",
  "",
  "It does not include other family members' details, other residents,",
  "or records the home keeps for care or legal reasons.",
  "",
].join("\r\n");

/** The finished zip for one person. */
const buildArchive = async ({ userId, now = new Date() }) => {
  const { user, links, uploads, visits, messages } = await loadRows(userId);
  if (!user) throw new Error("data export: the account no longer exists");

  const everything = [...links, ...uploads, ...visits];
  const [residents, homes, settings] = await Promise.all([
    namesById(
      Resident,
      everything.map((row) => row.residentId),
    ),
    namesById(
      Branch,
      [...everything, ...messages].map((row) => row.branchId),
    ),
    familyPreferenceService.getPreferences({ userId }),
  ]);
  const { profile, ...notificationSettings } = settings;
  const residentName = (row) => residents.get(String(row.residentId)) || "";
  const homeName = (row) => homes.get(String(row.branchId)) || "";

  const zip = new yazl.ZipFile();
  const photos = await addPhotos(zip, uploads);

  // one row per recipient is stored; the person sent it once
  const sent = new Map(messages.map((row) => [String(row.broadcastId), row]));

  const data = {
    preparedAt: now,
    you: {
      name: user.name || "",
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      accountCreatedAt: user.createdAt || null,
    },
    familyMemberships: links.map((link) => ({
      home: homeName(link),
      resident: APPROVED_ONCE.has(link.status) ? residentName(link) : "",
      relationship: link.relationship || "",
      status: link.status,
      nextOfKin: Boolean(link.isNextOfKin),
      requestedAt: link.requestedAt || link.createdAt || null,
    })),
    notificationSettings,
    photosAndMessagesShared: uploads.map((upload) => ({
      resident: residentName(upload),
      home: homeName(upload),
      message: upload.message || "",
      status: upload.status,
      reasonNotApproved: upload.rejectionReason || "",
      includeInGazette: Boolean(upload.includeInGazette),
      sentAt: upload.createdAt,
      photos: photos.get(String(upload._id)) || [],
    })),
    messagesToTheHome: [...sent.values()].map((row) => ({
      home: homeName(row),
      subject: row.subject || "",
      message: row.messageContent,
      sentAt: row.createdAt,
    })),
    visitHistory: visits.map((visit) => {
      const reply = (visit.replies || []).find(
        (entry) => String(entry.userId) === String(userId),
      );
      return {
        resident: residentName(visit),
        home: homeName(visit),
        startAt: visit.startAt,
        endAt: visit.endAt,
        askedByYou: String(visit.requestedBy) === String(userId),
        status: visit.status,
        yourReply: reply?.response || "",
        people: visit.partySize,
        note: visit.note || "",
        noteFromTheHome: visit.decisionNote || "",
      };
    }),
  };

  zip.addBuffer(
    Buffer.from(JSON.stringify(data, null, 2), "utf8"),
    "my-data.json",
  );
  zip.addBuffer(Buffer.from(README, "utf8"), "README.txt");
  return { buffer: await toBuffer(zip), name: user.name || "" };
};

module.exports = { buildArchive };
