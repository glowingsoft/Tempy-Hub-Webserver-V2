const moment = require("moment-timezone");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { FamilyGazetteItemStatus, FamilyUploadStatus } = require("@models/domainEnums");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, isValidObjectId, joinOne } = require("@appServices/family/familyPipeline");
const { listRelationships } = require("@appServices/family/familyAccessService");
const { drawGazette } = require("./familyGazettePdf");
const { publishedPostsOfSite } = require("./familyPostFilters");
const { getGazetteRules } = require("./familySettingsService");

const PHOTOS_PER_MESSAGE = 4;
const PHOTO_LOADS_AT_ONCE = 5;
const TITLE_LENGTH = 80;
const PDF_CONTENT_TYPE = "application/pdf";
const RENDERABLE = [FamilyGazetteItemStatus.BUILDING, FamilyGazetteItemStatus.FAILED, FamilyGazetteItemStatus.READY];

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const relationshipLabels = () => new Map(listRelationships().map((option) => [option.value, option.label]));

const lifeEntry = (post) => {
  const lines = String(post.message || "").trim().split(/\r?\n/).filter((line) => line.trim());
  const title = post.title ? cut(post.title, TITLE_LENGTH) : cut(lines[0] || "", TITLE_LENGTH);
  const text = post.title ? lines.join("\n") : lines.slice(1).join("\n") || lines[0] || "";
  return { title, text, mediaId: post.mediaIds?.[0] ?? null, postedAt: post.createdAt };
};

const coverOf = (messages) => [...messages].reverse().find((message) => message.mediaIds.length)?.mediaIds[0] ?? null;

const sendersOf = (messages, kinOf) => {
  const writers = new Map();
  messages.forEach((message) => {
    const entry = writers.get(message.authorKey) || { name: message.authorName, count: 0, kin: Boolean(kinOf.get(message.authorKey)) };
    entry.count += 1;
    writers.set(message.authorKey, entry);
  });
  return [...writers.values()].sort((a, b) => Number(b.kin) - Number(a.kin) || b.count - a.count || a.name.localeCompare(b.name)).map((entry) => entry.name);
};

const single = async (model, match, project) => {
  const [row] = await model.aggregate([{ $match: match }, { $project: project }]);
  return row || null;
};

// Read fresh at print time (BR-06): only still-approved messages and live wall posts, the blurred copy of a blurred photo, and no photos for a resident whose photo sharing is off.
const loadInput = async ({ item }) => {
  const [issue, resident, rules] = await Promise.all([
    single(FamilyGazetteIssue, { _id: item.issueId }, { number: 1, periodStart: 1, periodEnd: 1, closesAt: 1 }),
    single(Resident, { _id: item.residentId }, { name: 1, roomNumber: 1, photographyConsent: 1 }),
    getGazetteRules({ organizationId: item.organizationId }),
  ]);
  const branch = await single(Branch, { _id: item.branchId }, { name: 1, timezone: 1 });
  const timezone = branch?.timezone || "Europe/London";

  const uploads = item.uploadIds.length
    ? await FamilyUpload.aggregate([
        {
          $match: {
            _id: { $in: item.uploadIds },
            residentId: item.residentId,
            status: FamilyUploadStatus.APPROVED,
            includeInGazette: true,
          },
        },
        ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
        { $sort: { createdAt: 1, _id: 1 } },
        { $project: { message: 1, mediaIds: 1, authorId: 1, createdAt: 1, authorName: { $ifNull: ["$author.name", ""] } } },
      ])
    : [];

  const links = uploads.length
    ? await FamilyMember.aggregate([
        { $match: { residentId: item.residentId, userId: { $in: [...new Set(uploads.map((upload) => upload.authorId))] } } },
        { $sort: { status: 1, createdAt: -1 } },
        { $group: { _id: "$userId", relationship: { $first: "$relationship" }, isNextOfKin: { $max: "$isNextOfKin" } } },
      ])
    : [];
  const labels = relationshipLabels();
  const linkOf = new Map(links.map((link) => [String(link._id), link]));
  const kinOf = new Map(links.map((link) => [String(link._id), link.isNextOfKin]));

  const mayShowPhotos = resident?.photographyConsent === true;
  const messages = uploads.map((upload) => ({
    authorKey: String(upload.authorId),
    authorName: upload.authorName,
    relationshipLabel: labels.get(linkOf.get(String(upload.authorId))?.relationship) || "",
    createdAt: upload.createdAt,
    message: upload.message,
    mediaIds: mayShowPhotos ? upload.mediaIds.slice(0, PHOTOS_PER_MESSAGE) : [],
  }));

  const posts = item.postIds.length
    ? await FamilyPost.aggregate([
        ...publishedPostsOfSite({ organizationId: item.organizationId, branchId: item.branchId, includeTagged: true }),
        { $match: { _id: { $in: item.postIds }, taggedResidentIds: item.residentId } },
        { $sort: { createdAt: -1, _id: -1 } },
        { $project: { title: 1, message: 1, mediaIds: 1, createdAt: 1 } },
      ])
    : [];
  const life = posts.map(lifeEntry);

  return {
    issue,
    resident,
    timezone,
    gazette: {
      residentName: resident?.name || "",
      homeName: branch?.name || "",
      roomNumber: resident?.roomNumber || "",
      issueNumber: issue?.number ?? 0,
      periodStart: issue?.periodStart,
      periodEnd: issue?.periodEnd,
      nextClosesAt: issue ? moment.tz(issue.closesAt, timezone).add(rules.issueEveryDays, "days").toDate() : null,
      timezone,
      messages,
      senders: sendersOf(messages, kinOf),
      life,
      coverMediaId: coverOf(messages),
    },
  };
};

const loadPhotos = async (gazette) => {
  const wanted = [...new Set([...gazette.messages.flatMap((message) => message.mediaIds), ...gazette.life.map((entry) => entry.mediaId), gazette.coverMediaId].filter(Boolean).map(String))];
  if (!wanted.length) return new Map();

  const media = await FamilyMedia.aggregate([{ $match: { _id: { $in: wanted.map(toObjectId) } } }, { $project: { storageKey: 1, blurredKey: 1 } }]);
  const photos = new Map();
  for (let i = 0; i < media.length; i += PHOTO_LOADS_AT_ONCE) {
    await Promise.all(
      media.slice(i, i + PHOTO_LOADS_AT_ONCE).map(async (entry) => {
        try {
          photos.set(String(entry._id), await uploadAwsService.getObject(entry.blurredKey || entry.storageKey));
        } catch (error) {
          console.error("family gazette photo unreadable", error.message);
        }
      })
    );
  }
  return photos;
};

const loadItem = async (itemId) => {
  if (!isValidObjectId(itemId)) throw new AppError("gazette_item_not_found", 404);
  const [item] = await FamilyGazetteItem.aggregate([{ $match: { _id: toObjectId(itemId) } }]);
  if (!item) throw new AppError("gazette_item_not_found", 404);
  return item;
};

const draw = async (item) => {
  const input = await loadInput({ item });
  if (!input.gazette.messages.length) return { empty: true, input };

  const photos = await loadPhotos(input.gazette);
  const drawn = await drawGazette({ gazette: input.gazette, photos });
  return { empty: false, input, buffer: drawn.buffer, pageCount: drawn.pageCount };
};

const fileNameOf = (gazette) => {
  const slug = String(gazette.residentName || "gazette").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "gazette";
  return `${slug}-gazette-issue-${gazette.issueNumber}.pdf`;
};

// A failed render keeps the content for a retry; with no valid message left the gazette becomes no content and no PDF is made.
const renderItem = async ({ itemId, now = new Date() }) => {
  const item = await loadItem(itemId);
  if (!RENDERABLE.includes(item.status)) throw new AppError("gazette_not_renderable", 409);

  try {
    const drawn = await draw(item);
    if (drawn.empty) {
      await FamilyGazetteItem.updateOne({ _id: item._id, status: { $in: RENDERABLE } }, { $set: { status: FamilyGazetteItemStatus.NO_CONTENT, pdfKey: "", messageCount: 0, uploadIds: [], postIds: [], failureReason: "" } });
      return { status: FamilyGazetteItemStatus.NO_CONTENT, pdfKey: "" };
    }

    const { key } = await uploadAwsService.putObject({
      key: `family/gazettes/${item.issueId}/${item.residentId}.pdf`,
      body: drawn.buffer,
      contentType: PDF_CONTENT_TYPE,
    });
    await FamilyGazetteItem.updateOne(
      { _id: item._id, status: { $in: RENDERABLE } },
      { $set: { status: FamilyGazetteItemStatus.READY, pdfKey: key, pageCount: drawn.pageCount, failureReason: "", generatedAt: now } }
    );
    return { status: FamilyGazetteItemStatus.READY, pdfKey: key };
  } catch (error) {
    console.error("family gazette render failed", error.message);
    await FamilyGazetteItem.updateOne(
      { _id: item._id, status: { $in: RENDERABLE } },
      { $set: { status: FamilyGazetteItemStatus.FAILED, failureReason: "render_failed" } }
    );
    return { status: FamilyGazetteItemStatus.FAILED, pdfKey: "" };
  }
};

const getItemPdf = async ({ itemId }) => {
  const item = await loadItem(itemId);
  if ([FamilyGazetteItemStatus.NO_CONTENT, FamilyGazetteItemStatus.NO_FAMILY].includes(item.status)) throw new AppError("gazette_nothing_to_show", 409);

  if (item.pdfKey && [FamilyGazetteItemStatus.READY, FamilyGazetteItemStatus.PRINTED].includes(item.status)) {
    try {
      const input = await loadInput({ item });
      return { buffer: await uploadAwsService.getObject(item.pdfKey), filename: fileNameOf(input.gazette) };
    } catch (error) {
      console.error("family gazette stored pdf unreadable", error.message);
    }
  }
  const drawn = await draw(item);
  if (drawn.empty) throw new AppError("gazette_nothing_to_show", 409);
  return { buffer: drawn.buffer, filename: fileNameOf(drawn.input.gazette) };
};

module.exports = { renderItem, getItemPdf, loadInput, lifeEntry, sendersOf, coverOf, PHOTOS_PER_MESSAGE };
