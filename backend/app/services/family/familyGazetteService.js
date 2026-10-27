const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { FamilyGazetteItemStatus, FamilyUploadStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { getGazetteRules } = require("@adminServices/family/familySettingsService");
const { currentPeriod } = require("@adminServices/family/familyGazettePeriod");
const { gazetteTitle, periodLabel } = require("@adminServices/family/familyGazettePdf");
const adminGazettes = require("@adminServices/family/familyGazetteService");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");

const HEADLINE_LENGTH = 80;

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const single = async (model, match, project) => {
  const [row] = await model.aggregate([{ $match: match }, { $project: project }]);
  return row || null;
};

/**
 * The gazette that is being collected now for this resident: its dates, when it closes and how many of the
 * messages it can hold have been used. A message counts once it is approved and meant for the gazette, so
 * "9 of 30 messages" is what would be printed if it closed today. Nothing is shown until the organization
 * has saved a gazette schedule.
 */
const nextGazette = async ({ link, now = new Date() }) => {
  const rules = await getGazetteRules({ organizationId: link.organizationId });
  if (!rules.configured) return { scheduled: false, issue: null, messageCap: rules.messageCap };

  const branch = await single(Branch, { _id: toObjectId(link.branchId) }, { timezone: 1 });
  const timezone = branch?.timezone || "Europe/London";
  const period = currentPeriod({ anchorDate: rules.anchorDate, issueEveryDays: rules.issueEveryDays, timezone, at: now });

  const [built] = await FamilyGazetteIssue.aggregate([{ $match: { branchId: toObjectId(link.branchId), periodStart: period.start } }]);
  const [latest] = await FamilyGazetteIssue.aggregate([
    { $match: { branchId: toObjectId(link.branchId) } },
    { $group: { _id: null, number: { $max: "$number" } } },
  ]);
  const number = built?.number ?? (latest?.number ?? 0) + 1;
  const cap = built?.messageCap ?? rules.messageCap;

  const residentId = toObjectId(link.residentId);
  const [earlier, uploads, own] = await Promise.all([
    FamilyGazetteItem.aggregate([
      { $match: { residentId, ...(built ? { issueId: { $ne: built._id } } : {}) } },
      { $project: { uploadIds: 1, removedUploadIds: 1 } },
    ]),
    FamilyUpload.aggregate([
      {
        $match: {
          organizationId: toObjectId(link.organizationId),
          branchId: toObjectId(link.branchId),
          residentId,
          status: FamilyUploadStatus.APPROVED,
          includeInGazette: true,
          createdAt: { $lte: period.end },
        },
      },
      { $project: { _id: 1 } },
    ]),
    built ? FamilyGazetteItem.aggregate([{ $match: { issueId: built._id, residentId } }, { $project: { removedUploadIds: 1 } }]) : [],
  ]);

  const used = new Set([...earlier, ...own].flatMap((item) => [...(item.uploadIds ?? []), ...(item.removedUploadIds ?? [])]).map(String));
  const sent = uploads.filter((upload) => !used.has(String(upload._id))).length;
  const messagesUsed = Math.min(sent, cap);
  const started = now >= period.start;

  return {
    scheduled: true,
    issue: {
      number,
      state: started ? "collecting" : "notStarted",
      periodStart: period.start,
      periodEnd: period.end,
      periodLabel: periodLabel({ periodStart: period.start, periodEnd: period.end, timezone }),
      closesAt: period.closesAt,
    },
    messageCap: cap,
    messagesUsed,
    messagesSent: sent,
    remaining: Math.max(0, cap - sent),
    overflow: Math.max(0, sent - cap),
    isFull: sent >= cap,
    percentFull: Math.min(100, Math.round((messagesUsed / cap) * 100)),
  };
};

/** The gazettes the home has printed for this resident, newest first; the newest is flagged Latest. */
const listGazettes = async ({ link, page, limit, skip }) => {
  const match = { residentId: toObjectId(link.residentId), organizationId: toObjectId(link.organizationId), status: FamilyGazetteItemStatus.PRINTED };

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyGazetteItem,
    match,
    page,
    limit,
    skip,
    sort: { printedAt: -1, _id: -1 },
    extraFacets: {
      newest: [{ $match: match }, { $sort: { printedAt: -1, _id: -1 } }, { $limit: 1 }, { $project: { _id: 1 } }],
    },
    extraDataStages: [
      ...joinOne({ from: FamilyGazetteIssue, localField: "issueId", as: "issue", optional: true }),
      ...joinOne({ from: Resident, localField: "residentId", as: "resident", optional: true }),
      {
        $project: {
          _id: 0,
          gazetteId: "$_id",
          issueNumber: { $ifNull: ["$issue.number", 0] },
          periodStart: "$issue.periodStart",
          periodEnd: "$issue.periodEnd",
          residentName: { $ifNull: ["$resident.name", ""] },
          messageCount: { $size: "$uploadIds" },
          pageCount: 1,
          printedAt: 1,
          givenAt: 1,
        },
      },
    ],
  });

  const newest = result.newest?.[0]?._id;
  const [branch] = await Branch.aggregate([{ $match: { _id: toObjectId(link.branchId) } }, { $project: { timezone: 1 } }]);
  const timezone = branch?.timezone || "Europe/London";

  return {
    data: data.map((row) => ({
      ...row,
      title: gazetteTitle(row.residentName),
      periodLabel: row.periodStart ? periodLabel({ periodStart: row.periodStart, periodEnd: row.periodEnd, timezone }) : "",
      latest: String(row.gazetteId) === String(newest),
    })),
    meta,
  };
};

/** A printed gazette the caller's links reach: for one of their residents, at the home they are linked to. Anything else is "not found". */
const loadVisible = async ({ links, gazetteId }) => {
  if (!isValidObjectId(gazetteId)) throw new AppError("gazette_not_found", 404);

  const [item] = await FamilyGazetteItem.aggregate([{ $match: { _id: toObjectId(gazetteId), status: FamilyGazetteItemStatus.PRINTED } }]);
  const visible =
    item &&
    links.some(
      (link) =>
        String(link.residentId) === String(item.residentId) &&
        String(link.organizationId) === String(item.organizationId) &&
        String(link.branchId) === String(item.branchId)
    );
  if (!visible) throw new AppError("gazette_not_found", 404);
  return item;
};

/**
 * The reader: the cover photo and its message, then every message from the family and "Life at the home", as
 * the printed copy has them. What is no longer allowed (a resident's photo sharing switched off, a post
 * removed) is left out on every read.
 */
const getGazette = async ({ links, gazetteId }) => {
  const item = await loadVisible({ links, gazetteId });
  const { gazette } = await adminGazettes.loadInput({ item });

  const mediaIds = [...gazette.messages.flatMap((message) => message.mediaIds), ...gazette.life.map((entry) => entry.mediaId)].filter(Boolean);
  const media = mediaIds.length ? await FamilyMedia.aggregate([{ $match: { _id: { $in: mediaIds.map(toObjectId) } } }, { $project: { url: 1, blurredUrl: 1 } }]) : [];
  const urlOf = new Map(media.map((entry) => [String(entry._id), entry.blurredUrl || entry.url]));
  const photoUrl = (id) => (id ? urlOf.get(String(id)) || "" : "");

  const coverMessage = gazette.coverMediaId ? gazette.messages.find((message) => message.mediaIds.some((id) => String(id) === String(gazette.coverMediaId))) : null;

  return {
    gazetteId: item._id,
    title: gazetteTitle(gazette.residentName),
    issueNumber: gazette.issueNumber,
    periodStart: gazette.periodStart,
    periodEnd: gazette.periodEnd,
    periodLabel: periodLabel(gazette),
    residentName: gazette.residentName,
    homeName: gazette.homeName,
    pageCount: item.pageCount,
    printedAt: item.printedAt,
    givenAt: item.givenAt,
    cover: coverMessage
      ? {
          photoUrl: photoUrl(gazette.coverMediaId),
          headline: cut(String(coverMessage.message || "").trim().split(/(?<=[.!?])\s/)[0] || "", HEADLINE_LENGTH),
          message: coverMessage.message,
          authorName: coverMessage.authorName,
          relationshipLabel: coverMessage.relationshipLabel,
        }
      : null,
    messages: gazette.messages.map((message) => ({
      authorName: message.authorName,
      relationshipLabel: message.relationshipLabel,
      message: message.message,
      photos: message.mediaIds.map((id) => ({ url: photoUrl(id) })).filter((photo) => photo.url),
      sentAt: message.createdAt,
    })),
    life: gazette.life.map((entry) => ({ title: entry.title, text: entry.text, photoUrl: photoUrl(entry.mediaId), postedAt: entry.postedAt })),
  };
};

/** The PDF the home printed: the stored copy, or drawn again from the saved content when it was lost. */
const getPdf = async ({ links, gazetteId }) => {
  const item = await loadVisible({ links, gazetteId });
  return adminGazettes.getItemPdf({ itemId: item._id });
};

module.exports = { nextGazette, listGazettes, getGazette, getPdf };
