const moment = require("moment-timezone");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const {
  FamilyGazetteIssueStatus,
  FamilyGazetteItemStatus,
} = require("@models/domainEnums");
const { generateMeta } = require("@utils/responseUtil");
const { facetCount } = require("@utils/paginate");
const { searchText } = require("@utils/familyQuery");
const { AppError } = require("@services/_errors/AppError");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
} = require("@appServices/family/familyPipeline");
const {
  listRelationships,
} = require("@appServices/family/familyAccessService");
const { resolveSite, assertMayChangeSite } = require("./familySite");
const { getGazetteRules } = require("./familySettingsService");
const {
  choosePeriod,
  generateIssue,
  rebuildItem,
} = require("./familyGazetteEngine");
const yazl = require("yazl");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { renderItem, getItemPdf, lifeEntry } = require("./familyGazetteService");
const { notifyPrinted } = require("./familyGazetteNotifications");

const MAX_CONCURRENT_RENDERS = 2;
const MAX_ZIP_FILES = 100;
const STUCK_AFTER_MS = 20 * 60 * 1000;
const RECOVER_PER_RUN = 20;

const Status = FamilyGazetteItemStatus;
const GazetteState = {
  BUILDING: "building",
  READY: "ready",
  NOT_READY: "notReady",
  FAILED: "failed",
  PRINTED: "printed",
};
const STATES = Object.values(GazetteState);
const TABS = ["all", ...STATES];

const LABELS = {
  printed: "Printed",
  notReady: "Not ready",
  failed: "Failed",
  ready: "Ready",
  building: "Building",
};
const REASON_LABELS = {
  noFamily: "No family linked",
  noContent: "No content",
};

// The several stored statuses that mean "not ready to print" show as one, with the reason beside it.
const NOT_READY_STATUSES = [Status.NO_FAMILY, Status.NO_CONTENT];

const stateExpression = {
  $switch: {
    branches: [
      { case: { $eq: ["$status", Status.PRINTED] }, then: GazetteState.PRINTED },
      {
        case: { $in: ["$status", NOT_READY_STATUSES] },
        then: GazetteState.NOT_READY,
      },
      { case: { $eq: ["$status", Status.FAILED] }, then: GazetteState.FAILED },
      { case: { $eq: ["$status", Status.READY] }, then: GazetteState.READY },
    ],
    default: GazetteState.BUILDING,
  },
};

const reasonExpression = {
  $switch: {
    branches: [
      { case: { $eq: ["$status", Status.NO_FAMILY] }, then: "noFamily" },
      { case: { $eq: ["$status", Status.NO_CONTENT] }, then: "noContent" },
    ],
    default: "",
  },
};

const TAB_FILTERS = {
  all: null,
  ready: { status: Status.READY },
  notReady: { status: { $in: NOT_READY_STATUSES } },
  failed: { status: Status.FAILED },
  printed: { status: Status.PRINTED },
  building: { status: Status.BUILDING },
};

const labelOf = ({ state, reason, overCap }, cap) => {
  if (state === GazetteState.NOT_READY) return REASON_LABELS[reason];
  if (state === GazetteState.READY && overCap) return `Over ${cap} messages`;
  return LABELS[state];
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const currentIssues = async ({ organizationId, branchId }) =>
  FamilyGazetteIssue.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        ...(branchId ? { branchId: toObjectId(branchId) } : {}),
      },
    },
    { $sort: { periodStart: -1, _id: -1 } },
    { $group: { _id: "$branchId", issue: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$issue" } },
    { $sort: { branchId: 1 } },
  ]);

const issueSummary = (issue, homes) => ({
  issueId: issue._id,
  branchId: issue.branchId,
  homeName: homes.get(String(issue.branchId)) || "",
  number: issue.number,
  periodStart: issue.periodStart,
  periodEnd: issue.periodEnd,
  closesAt: issue.closesAt,
  messageCap: issue.messageCap,
  status: issue.status,
  generatedAt: issue.generatedAt,
});

const homeNames = async (branchIds) => {
  if (!branchIds.length) return new Map();
  const branches = await Branch.aggregate([
    { $match: { _id: { $in: branchIds } } },
    { $project: { name: 1 } },
  ]);
  return new Map(branches.map((branch) => [String(branch._id), branch.name]));
};

const matching = (labels, text) => {
  const needle = text.toLowerCase();
  return Object.keys(labels).filter((key) =>
    labels[key].toLowerCase().includes(needle),
  );
};

const listGazettes = async ({
  organizationId,
  branchId,
  status,
  keyword,
  page,
  limit,
  skip,
}) => {
  if (status && !TABS.includes(status))
    throw new AppError("invalid_status_filter", 400);
  const issues = await currentIssues({ organizationId, branchId });
  const emptyCounts = {
    ready: 0,
    notReady: 0,
    failed: 0,
    printed: 0,
    building: 0,
    overCap: 0,
  };
  if (!issues.length)
    return {
      data: [],
      meta: {
        ...generateMeta(page, limit, 0),
        counts: emptyCounts,
      },
    };

  const text = searchText(keyword);
  const matchingStates = text ? matching(LABELS, text) : [];
  const matchingReasons = text ? matching(REASON_LABELS, text) : [];
  const search = text
    ? [
        {
          $match: {
            $or: [
              { "resident.name": { $regex: text, $options: "i" } },
              { "resident.roomNumber": { $regex: text, $options: "i" } },
              ...(matchingStates.length
                ? [{ state: { $in: matchingStates } }]
                : []),
              ...(matchingReasons.length
                ? [{ reason: { $in: matchingReasons } }]
                : []),
            ],
          },
        },
      ]
    : [];
  const tab = TAB_FILTERS[status || "all"];

  const [result] = await FamilyGazetteItem.aggregate([
    { $match: { issueId: { $in: issues.map((issue) => issue._id) } } },
    ...joinOne({
      from: Resident,
      localField: "residentId",
      as: "resident",
      optional: true,
    }),
    { $addFields: { state: stateExpression, reason: reasonExpression } },
    ...search,
    {
      $facet: {
        data: [
          ...(tab ? [{ $match: tab }] : []),
          { $sort: { "resident.name": 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              itemId: "$_id",
              issueId: 1,
              branchId: 1,
              residentId: 1,
              residentName: { $ifNull: ["$resident.name", ""] },
              photoUrl: { $ifNull: ["$resident.photoUrl", ""] },
              roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
              familyCount: 1,
              messageCount: 1,
              overCap: 1,
              status: "$state",
              reason: 1,
              hasPdf: { $ne: ["$pdfKey", ""] },
              failureReason: 1,
              generatedAt: 1,
              printedAt: 1,
              givenAt: 1,
            },
          },
        ],
        totalCount: [...(tab ? [{ $match: tab }] : []), { $count: "count" }],
        counts: [
          {
            $group: {
              _id: null,
              ready: {
                $sum: { $cond: [{ $eq: ["$status", Status.READY] }, 1, 0] },
              },
              notReady: {
                $sum: {
                  $cond: [{ $in: ["$status", NOT_READY_STATUSES] }, 1, 0],
                },
              },
              failed: {
                $sum: { $cond: [{ $eq: ["$status", Status.FAILED] }, 1, 0] },
              },
              printed: {
                $sum: { $cond: [{ $eq: ["$status", Status.PRINTED] }, 1, 0] },
              },
              building: {
                $sum: { $cond: [{ $eq: ["$status", Status.BUILDING] }, 1, 0] },
              },
              overCap: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$overCap", true] },
                        {
                          $not: [
                            {
                              $in: [
                                "$status",
                                [
                                  Status.PRINTED,
                                  Status.NO_FAMILY,
                                  Status.NO_CONTENT,
                                ],
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
      },
    },
  ]);

  const capOf = new Map(
    issues.map((issue) => [String(issue._id), issue.messageCap]),
  );
  const { _id, ...counts } = result.counts[0] || { ...emptyCounts };

  return {
    data: result.data.map(({ issueId, ...row }) => ({
      ...row,
      statusLabel: labelOf(
        { state: row.status, reason: row.reason, overCap: row.overCap },
        capOf.get(String(issueId)),
      ),
    })),
    meta: {
      ...generateMeta(page, limit, facetCount(result.totalCount)),
      counts: { ...emptyCounts, ...counts },
    },
  };
};

const loadItemInOrganization = async ({ organizationId, itemId }) => {
  if (!isValidObjectId(itemId))
    throw new AppError("gazette_item_not_found", 404);
  const [item] = await FamilyGazetteItem.aggregate([
    {
      $match: {
        _id: toObjectId(itemId),
        organizationId: toObjectId(organizationId),
      },
    },
  ]);
  if (!item) throw new AppError("gazette_item_not_found", 404);
  return item;
};

const photoOf = (media) =>
  media ? { mediaId: media._id, url: media.blurredUrl || media.url } : null;

const getGazette = async ({ organizationId, itemId }) => {
  const item = await loadItemInOrganization({ organizationId, itemId });
  const [issue] = await FamilyGazetteIssue.aggregate([
    { $match: { _id: item.issueId } },
  ]);
  const [resident] = await Resident.aggregate([
    { $match: { _id: item.residentId } },
    { $project: { name: 1, roomNumber: 1, photoUrl: 1 } },
  ]);
  const homes = await homeNames([item.branchId]);

  const sentIds = [
    ...item.uploadIds,
    ...item.movedUploadIds,
    ...item.removedUploadIds,
  ];
  const uploads = sentIds.length
    ? await FamilyUpload.aggregate([
        { $match: { _id: { $in: sentIds }, residentId: item.residentId } },
        ...joinOne({
          from: User,
          localField: "authorId",
          as: "author",
          optional: true,
        }),
        { $sort: { createdAt: 1, _id: 1 } },
        {
          $project: {
            message: 1,
            mediaIds: 1,
            authorId: 1,
            createdAt: 1,
            authorName: { $ifNull: ["$author.name", ""] },
          },
        },
      ])
    : [];
  const links = uploads.length
    ? await FamilyMember.aggregate([
        {
          $match: {
            residentId: item.residentId,
            userId: {
              $in: [...new Set(uploads.map((upload) => upload.authorId))],
            },
          },
        },
        { $sort: { status: 1, createdAt: -1 } },
        {
          $group: { _id: "$userId", relationship: { $first: "$relationship" } },
        },
      ])
    : [];
  const labels = new Map(
    listRelationships().map((option) => [option.value, option.label]),
  );
  const relationshipOf = new Map(
    links.map((link) => [
      String(link._id),
      labels.get(link.relationship) || "",
    ]),
  );

  const posts = item.postIds.length
    ? await FamilyPost.aggregate([
        { $match: { _id: { $in: item.postIds } } },
        { $sort: { createdAt: -1, _id: -1 } },
        { $project: { title: 1, message: 1, mediaIds: 1, createdAt: 1 } },
      ])
    : [];

  const mediaIds = [
    ...uploads.flatMap((upload) => upload.mediaIds),
    ...posts.flatMap((post) => post.mediaIds.slice(0, 1)),
  ];
  const media = mediaIds.length
    ? await FamilyMedia.aggregate([
        { $match: { _id: { $in: mediaIds } } },
        { $project: { url: 1, blurredUrl: 1 } },
      ])
    : [];
  const mediaById = new Map(media.map((entry) => [String(entry._id), entry]));

  const included = new Set(item.uploadIds.map(String));
  const moved = new Set(item.movedUploadIds.map(String));
  const removed = new Set(item.removedUploadIds.map(String));

  const messages = uploads.map((upload) => ({
    uploadId: upload._id,
    authorName: upload.authorName,
    relationshipLabel: relationshipOf.get(String(upload.authorId)) || "",
    message: upload.message,
    photos: upload.mediaIds
      .map((id) => photoOf(mediaById.get(String(id))))
      .filter(Boolean),
    sentAt: upload.createdAt,
    placement: included.has(String(upload._id))
      ? "included"
      : moved.has(String(upload._id))
        ? "movedToNext"
        : removed.has(String(upload._id))
          ? "removed"
          : "",
  }));

  const { state, reason } = groupOf(item);
  return {
    itemId: item._id,
    issue: issue ? issueSummary(issue, homes) : null,
    resident: {
      residentId: item.residentId,
      name: resident?.name || "",
      roomNumber: resident?.roomNumber || "",
      photoUrl: resident?.photoUrl || "",
    },
    status: state,
    reason,
    statusLabel: labelOf(
      { state, reason, overCap: item.overCap },
      issue?.messageCap,
    ),
    familyCount: item.familyCount,
    messageCount: item.messageCount,
    includedCount: item.uploadIds.length,
    overCap: item.overCap,
    hasPdf: Boolean(item.pdfKey),
    failureReason: item.failureReason,
    generatedAt: item.generatedAt,
    printedAt: item.printedAt,
    givenAt: item.givenAt,
    messages,
    life: posts.map((post) => {
      const entry = lifeEntry(post);
      return {
        postId: post._id,
        title: entry.title,
        text: entry.text,
        photoUrl: mediaById.get(String(entry.mediaId))?.url || "",
        postedAt: entry.postedAt,
      };
    }),
  };
};

const groupOf = (item) => {
  if (item.status === Status.PRINTED)
    return { state: GazetteState.PRINTED, reason: "" };
  if (item.status === Status.NO_FAMILY)
    return { state: GazetteState.NOT_READY, reason: "noFamily" };
  if (item.status === Status.NO_CONTENT)
    return { state: GazetteState.NOT_READY, reason: "noContent" };
  if (item.status === Status.FAILED)
    return { state: GazetteState.FAILED, reason: "" };
  return {
    state:
      item.status === Status.READY ? GazetteState.READY : GazetteState.BUILDING,
    reason: "",
  };
};

const rendering = new Set();

const renderIssue = async ({ issueId, now = new Date() }) => {
  const key = String(issueId);
  if (rendering.has(key)) return { skipped: true };
  rendering.add(key);
  try {
    const waiting = await FamilyGazetteItem.aggregate([
      { $match: { issueId: toObjectId(issueId), status: Status.BUILDING } },
      { $project: { _id: 1 } },
    ]);
    const counts = { ready: 0, failed: 0, noContent: 0 };
    for (let i = 0; i < waiting.length; i += MAX_CONCURRENT_RENDERS) {
      const batch = waiting.slice(i, i + MAX_CONCURRENT_RENDERS);
      await FamilyGazetteItem.updateMany(
        {
          _id: { $in: batch.map((item) => item._id) },
          status: Status.BUILDING,
        },
        { $set: { renderClaimedAt: now } },
      );
      const results = await Promise.all(
        batch.map((item) => renderItem({ itemId: item._id, now })),
      );
      results.forEach((result) => {
        if (result.status === Status.READY) counts.ready += 1;
        else if (result.status === Status.FAILED) counts.failed += 1;
        else if (result.status === Status.NO_CONTENT) counts.noContent += 1;
      });
    }
    const [stillBuilding] = await FamilyGazetteItem.aggregate([
      { $match: { issueId: toObjectId(issueId), status: Status.BUILDING } },
      { $count: "count" },
    ]);
    if (!stillBuilding?.count)
      await FamilyGazetteIssue.updateOne(
        { _id: toObjectId(issueId) },
        { $set: { status: FamilyGazetteIssueStatus.READY } },
      );
    return { skipped: false, ...counts };
  } finally {
    rendering.delete(key);
  }
};

// A claim takes each stuck gazette over, so two servers never draw the same one.
const recoverStuckGazettes = async ({
  now = new Date(),
  limit = RECOVER_PER_RUN,
} = {}) => {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const touched = new Set();
  const counts = { recovered: 0, ready: 0, failed: 0, noContent: 0 };

  for (let i = 0; i < limit; i += 1) {
    const claimed = await FamilyGazetteItem.findOneAndUpdate(
      {
        status: Status.BUILDING,
        generatedAt: { $lt: cutoff },
        $or: [{ renderClaimedAt: null }, { renderClaimedAt: { $lt: cutoff } }],
      },
      { $set: { renderClaimedAt: now } },
      { sort: { generatedAt: 1, _id: 1 }, new: true, lean: true },
    );
    if (!claimed) break;

    const result = await renderItem({ itemId: claimed._id, now });
    touched.add(String(claimed.issueId));
    counts.recovered += 1;
    if (result.status === Status.READY) counts.ready += 1;
    else if (result.status === Status.FAILED) counts.failed += 1;
    else if (result.status === Status.NO_CONTENT) counts.noContent += 1;
  }

  for (const issueId of touched) {
    const [stillBuilding] = await FamilyGazetteItem.aggregate([
      { $match: { issueId: toObjectId(issueId), status: Status.BUILDING } },
      { $count: "count" },
    ]);
    if (!stillBuilding?.count)
      await FamilyGazetteIssue.updateOne(
        { _id: toObjectId(issueId) },
        { $set: { status: FamilyGazetteIssueStatus.READY } },
      );
  }
  return counts;
};

const renderInBackground = (issueId) => {
  setImmediate(() => {
    renderIssue({ issueId }).catch((error) =>
      console.error("family gazette issue render failed", error.message),
    );
  });
};

const generateForSite = async ({
  actor,
  organizationId,
  branchId,
  now = new Date(),
  background = true,
}) => {
  const site = await resolveSite({ actor, organizationId, branchId });
  const [branch] = await Branch.aggregate([
    { $match: { _id: toObjectId(site.branchId) } },
    { $project: { timezone: 1 } },
  ]);
  const rules = await getGazetteRules({ organizationId });
  const period = choosePeriod({
    rules,
    timezone: branch?.timezone || "Europe/London",
    at: now,
  });

  const built = await generateIssue({
    organizationId,
    branchId: site.branchId,
    period,
    actor,
    now,
  });
  await FamilyGazetteIssue.updateOne(
    { _id: built.issue._id },
    { $set: { status: FamilyGazetteIssueStatus.BUILDING } },
  );
  if (background) renderInBackground(built.issue._id);

  return {
    issueId: built.issue._id,
    number: built.issue.number,
    periodStart: built.issue.periodStart,
    periodEnd: built.issue.periodEnd,
    closesAt: built.issue.closesAt,
    residents: built.residents,
    counts: built.counts,
    overCap: built.overCap,
  };
};

const currentIssueForStaff = async ({ actor, organizationId, branchId }) => {
  const site = await resolveSite({ actor, organizationId, branchId });
  const [issue] = await currentIssues({
    organizationId,
    branchId: site.branchId,
  });
  if (!issue) throw new AppError("gazette_issue_not_found", 404);
  return issue;
};

const printAll = async ({
  actor,
  organizationId,
  branchId,
  itemIds,
  now = new Date(),
}) => {
  const issue = await currentIssueForStaff({ actor, organizationId, branchId });
  const filter = {
    issueId: issue._id,
    status: Status.READY,
    pdfKey: { $ne: "" },
  };
  if (itemIds !== undefined) {
    if (
      !Array.isArray(itemIds) ||
      !itemIds.length ||
      itemIds.some((id) => !isValidObjectId(id))
    )
      throw new AppError("gazette_items_invalid", 400);
    filter._id = { $in: itemIds.map(toObjectId) };
  }
  // Moved one at a time so only the families of gazettes that really changed are told.
  const candidates = await FamilyGazetteItem.aggregate([
    { $match: filter },
    { $project: { _id: 1 } },
  ]);
  let printed = 0;
  for (const candidate of candidates) {
    const done = await FamilyGazetteItem.findOneAndUpdate(
      { _id: candidate._id, status: Status.READY, pdfKey: { $ne: "" } },
      {
        $set: { status: Status.PRINTED, printedBy: actor._id, printedAt: now },
      },
      { new: true, lean: true },
    );
    if (!done) continue;
    printed += 1;
    await notifyPrinted({ item: done, actorId: actor._id });
  }
  return { printed };
};

const retryIssue = async ({
  actor,
  organizationId,
  branchId,
  background = true,
}) => {
  const issue = await currentIssueForStaff({ actor, organizationId, branchId });
  const reset = await FamilyGazetteItem.updateMany(
    { issueId: issue._id, status: Status.FAILED },
    { $set: { status: Status.BUILDING, failureReason: "" } },
  );
  await FamilyGazetteIssue.updateOne(
    { _id: issue._id },
    { $set: { status: FamilyGazetteIssueStatus.BUILDING } },
  );
  if (background) renderInBackground(issue._id);
  return { retrying: reset.modifiedCount ?? 0 };
};

const loadItemForStaff = async ({ actor, organizationId, itemId }) => {
  const item = await loadItemInOrganization({ organizationId, itemId });
  await assertMayChangeSite({ actor, organizationId, branchId: item.branchId });
  return item;
};

const idList = (value, key) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => !isValidObjectId(id)))
    throw new AppError(key, 400, { cap: "" });
  return value;
};

const regenerate = async ({
  actor,
  organizationId,
  itemId,
  removeUploadIds,
  uploadIds,
  now = new Date(),
}) => {
  const item = await loadItemForStaff({ actor, organizationId, itemId });
  if (item.status === Status.PRINTED)
    throw new AppError("gazette_already_printed", 409);
  const removing = idList(removeUploadIds, "gazette_upload_invalid");
  const chosen = idList(uploadIds, "gazette_selection_invalid");
  if (chosen && !chosen.length)
    throw new AppError("gazette_selection_invalid", 400, { cap: "" });

  const [issue] = await FamilyGazetteIssue.aggregate([
    { $match: { _id: item.issueId } },
  ]);
  const content = await rebuildItem({
    item,
    issue,
    removeUploadIds: removing ?? [],
    chosenUploadIds: chosen ?? null,
    now,
  });
  if (content.status === Status.BUILDING)
    await renderItem({ itemId: item._id, now });
  return getGazette({ organizationId, itemId });
};

const markPrinted = async ({
  actor,
  organizationId,
  itemId,
  now = new Date(),
}) => {
  const item = await loadItemForStaff({ actor, organizationId, itemId });
  if (item.status === Status.PRINTED)
    return getGazette({ organizationId, itemId });
  if (item.status !== Status.READY || !item.pdfKey)
    throw new AppError("gazette_not_ready", 409);

  const done = await FamilyGazetteItem.updateOne(
    { _id: item._id, status: Status.READY },
    { $set: { status: Status.PRINTED, printedBy: actor._id, printedAt: now } },
  );
  if (!done.matchedCount) throw new AppError("gazette_not_ready", 409);
  await notifyPrinted({ item, actorId: actor._id });
  return getGazette({ organizationId, itemId });
};

const markGiven = async ({
  actor,
  organizationId,
  itemId,
  givenOn,
  now = new Date(),
}) => {
  const item = await loadItemForStaff({ actor, organizationId, itemId });
  if (item.status !== Status.PRINTED)
    throw new AppError("gazette_not_printed", 409);

  let day = now;
  if (givenOn !== undefined) {
    const parsed =
      typeof givenOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(givenOn)
        ? moment.utc(givenOn, "YYYY-MM-DD", true)
        : null;
    if (
      !parsed ||
      !parsed.isValid() ||
      parsed.isAfter(moment.utc(now).endOf("day"))
    )
      throw new AppError("gazette_given_invalid", 400);
    day = parsed.toDate();
  }
  await FamilyGazetteItem.updateOne(
    { _id: item._id, status: Status.PRINTED },
    { $set: { givenAt: day } },
  );
  return getGazette({ organizationId, itemId });
};

const getPdf = async ({ organizationId, itemId }) => {
  await loadItemInOrganization({ organizationId, itemId });
  return getItemPdf({ itemId });
};

const downloadEntries = async ({ organizationId, branchId }) => {
  const issues = await currentIssues({ organizationId, branchId });
  if (!issues.length) throw new AppError("gazette_nothing_to_download", 404);
  const homes = await homeNames([
    ...new Set(issues.map((issue) => issue.branchId)),
  ]);

  const rows = await FamilyGazetteItem.aggregate([
    {
      $match: {
        issueId: { $in: issues.map((issue) => issue._id) },
        status: { $in: [Status.READY, Status.PRINTED] },
        pdfKey: { $ne: "" },
      },
    },
    ...joinOne({
      from: Resident,
      localField: "residentId",
      as: "resident",
      optional: true,
    }),
    { $sort: { "resident.name": 1, _id: 1 } },
    { $limit: MAX_ZIP_FILES + 1 },
    {
      $project: {
        issueId: 1,
        pdfKey: 1,
        residentName: { $ifNull: ["$resident.name", ""] },
      },
    },
  ]);
  if (!rows.length) throw new AppError("gazette_nothing_to_download", 404);
  if (rows.length > MAX_ZIP_FILES)
    throw new AppError("gazette_too_many_to_download", 400, {
      max: MAX_ZIP_FILES,
    });

  const issueOf = new Map(issues.map((issue) => [String(issue._id), issue]));
  const used = new Set();
  const slug = (text) =>
    String(text || "gazette")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gazette";
  const entries = rows.map((row) => {
    const issue = issueOf.get(String(row.issueId));
    const folder =
      issues.length > 1 ? `${slug(homes.get(String(issue.branchId)))}/` : "";
    let name = `${folder}${slug(row.residentName)}-gazette-issue-${issue.number}.pdf`;
    for (let n = 2; used.has(name); n += 1)
      name = `${folder}${slug(row.residentName)}-${n}-gazette-issue-${issue.number}.pdf`;
    used.add(name);
    return { name, key: row.pdfKey };
  });
  return {
    entries,
    fileName:
      issues.length === 1
        ? `gazettes-issue-${issues[0].number}.zip`
        : "gazettes.zip",
  };
};

// PDFs are stored as they are; one that cannot be read is skipped and logged.
const zipStream = (entries) => {
  const zip = new yazl.ZipFile();
  (async () => {
    for (const entry of entries) {
      try {
        zip.addBuffer(await uploadAwsService.getObject(entry.key), entry.name, {
          compress: false,
        });
      } catch (error) {
        console.error(
          "family gazette pdf unreadable for the zip",
          error.message,
        );
      }
    }
    zip.end();
  })();
  return zip.outputStream;
};

module.exports = {
  renderInBackground,
  zipStream,
  recoverStuckGazettes,
  listGazettes,
  getGazette,
  generateForSite,
  renderIssue,
  printAll,
  retryIssue,
  regenerate,
  markPrinted,
  markGiven,
  getPdf,
  downloadEntries,
  TABS,
};
