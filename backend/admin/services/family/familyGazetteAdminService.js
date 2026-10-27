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
const STATES = [
  "printed",
  "noFamily",
  "noContent",
  "failed",
  "overCap",
  "ready",
  "building",
];
const TABS = [
  "all",
  "ready",
  "noContent",
  "overCap",
  "printed",
  "noFamily",
  "failed",
  "building",
];

const LABELS = {
  printed: "Printed",
  noFamily: "No family linked",
  noContent: "No content",
  failed: "Failed",
  ready: "Ready",
  building: "Building",
};
const labelOf = (state, cap) =>
  state === "overCap" ? `Over ${cap} messages` : LABELS[state];

/** What a row shows as its status: the most important thing about it. */
const stateExpression = {
  $switch: {
    branches: [
      { case: { $eq: ["$status", Status.PRINTED] }, then: "printed" },
      { case: { $eq: ["$status", Status.NO_FAMILY] }, then: "noFamily" },
      { case: { $eq: ["$status", Status.NO_CONTENT] }, then: "noContent" },
      { case: { $eq: ["$status", Status.FAILED] }, then: "failed" },
      { case: { $eq: ["$overCap", true] }, then: "overCap" },
      { case: { $eq: ["$status", Status.READY] }, then: "ready" },
    ],
    default: "building",
  },
};

const TAB_FILTERS = {
  all: null,
  ready: { status: Status.READY },
  noContent: { status: Status.NO_CONTENT },
  overCap: {
    overCap: true,
    status: { $nin: [Status.PRINTED, Status.NO_FAMILY, Status.NO_CONTENT] },
  },
  printed: { status: Status.PRINTED },
  noFamily: { status: Status.NO_FAMILY },
  failed: { status: Status.FAILED },
  building: { status: Status.BUILDING },
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The issue each site is on now (its newest). The Gazettes page works on "this issue", so across several sites it
 * shows each site's current one; nothing on the page asks for an older one.
 */
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

/** States whose label contains what was typed, so "print" finds the printed ones. */
const statesMatching = (text) => {
  const needle = text.toLowerCase();
  return STATES.filter((state) =>
    [LABELS[state] || "Over messages"].some((label) =>
      label.toLowerCase().includes(needle),
    ),
  );
};

/**
 * The Gazettes page: one row per resident for the issue each site is on. meta.counts feeds the cards and tabs
 * and ignores the tab chosen. The page shows nothing about the issue itself, so none of it is returned.
 */
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
    total: 0,
    ready: 0,
    noContent: 0,
    overCap: 0,
    printed: 0,
    noFamily: 0,
    failed: 0,
    building: 0,
    needReview: 0,
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
  const matchingStates = text ? statesMatching(text) : [];
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
    { $addFields: { state: stateExpression } },
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
              status: 1,
              state: 1,
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
              total: { $sum: 1 },
              ready: {
                $sum: { $cond: [{ $eq: ["$status", Status.READY] }, 1, 0] },
              },
              noContent: {
                $sum: {
                  $cond: [{ $eq: ["$status", Status.NO_CONTENT] }, 1, 0],
                },
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
              printed: {
                $sum: { $cond: [{ $eq: ["$status", Status.PRINTED] }, 1, 0] },
              },
              noFamily: {
                $sum: { $cond: [{ $eq: ["$status", Status.NO_FAMILY] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ["$status", Status.FAILED] }, 1, 0] },
              },
              building: {
                $sum: { $cond: [{ $eq: ["$status", Status.BUILDING] }, 1, 0] },
              },
              needReview: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        {
                          $in: ["$status", [Status.NO_CONTENT, Status.FAILED]],
                        },
                        {
                          $and: [
                            { $eq: ["$overCap", true] },
                            {
                              $not: [
                                {
                                  $in: [
                                    "$status",
                                    [Status.PRINTED, Status.NO_FAMILY],
                                  ],
                                },
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
      statusLabel: labelOf(row.state, capOf.get(String(issueId))),
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

/**
 * One resident's gazette for the staff to check and fix: every message that was sent for it, whether it is in the
 * gazette, was left for the next issue or was taken out, plus the wall posts for "Life at the home".
 */
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

  const state = stateOf(item);
  return {
    itemId: item._id,
    issue: issue ? issueSummary(issue, homes) : null,
    resident: {
      residentId: item.residentId,
      name: resident?.name || "",
      roomNumber: resident?.roomNumber || "",
      photoUrl: resident?.photoUrl || "",
    },
    status: item.status,
    state,
    statusLabel: labelOf(state, issue?.messageCap),
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

const stateOf = (item) => {
  if (item.status === Status.PRINTED) return "printed";
  if (item.status === Status.NO_FAMILY) return "noFamily";
  if (item.status === Status.NO_CONTENT) return "noContent";
  if (item.status === Status.FAILED) return "failed";
  if (item.overCap) return "overCap";
  return item.status === Status.READY ? "ready" : "building";
};

// ---------------------------------------------------------------- making gazettes

const rendering = new Set();

/** Draws every gazette of an issue that is waiting for its PDF, a couple at a time, then closes the issue's building state. */
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
      await FamilyGazetteItem.updateMany({ _id: { $in: batch.map((item) => item._id) }, status: Status.BUILDING }, { $set: { renderClaimedAt: now } });
      const results = await Promise.all(batch.map((item) => renderItem({ itemId: item._id, now })));
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

/**
 * Drawing runs inside the server that took the request, so a restart can leave gazettes at Building with nobody
 * drawing them. Run on a schedule, this takes over any that have waited a long time without a drawing being started
 * and draws them. Taking one over is a single claim, so two servers never draw the same gazette; the issue is marked
 * ready once none of its gazettes is still waiting.
 */
const recoverStuckGazettes = async ({ now = new Date(), limit = RECOVER_PER_RUN } = {}) => {
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
      { sort: { generatedAt: 1, _id: 1 }, new: true, lean: true }
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
    const [stillBuilding] = await FamilyGazetteItem.aggregate([{ $match: { issueId: toObjectId(issueId), status: Status.BUILDING } }, { $count: "count" }]);
    if (!stillBuilding?.count) await FamilyGazetteIssue.updateOne({ _id: toObjectId(issueId) }, { $set: { status: FamilyGazetteIssueStatus.READY } });
  }
  return counts;
};

/** Rendering runs after the request has been answered; the page watches the rows change from Building to Ready. */
const renderInBackground = (issueId) => {
  setImmediate(() => {
    renderIssue({ issueId }).catch((error) =>
      console.error("family gazette issue render failed", error.message),
    );
  });
};

/**
 * "Generate all": works out what every resident's gazette will say for the site's current issue, answers at once,
 * and draws the PDFs in the background. Asking again builds the issue again (printed gazettes are left alone).
 */
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

/**
 * The site's current issue, for a button that acts on "this page". A site or line manager works on their own site;
 * an owner or super admin says which site, as with Generate all.
 */
const currentIssueForStaff = async ({ actor, organizationId, branchId }) => {
  const site = await resolveSite({ actor, organizationId, branchId });
  const [issue] = await currentIssues({ organizationId, branchId: site.branchId });
  if (!issue) throw new AppError("gazette_issue_not_found", 404);
  return issue;
};

/** Mark printed for the page: every ready gazette of the site's current issue, or just the ones named. */
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
  // Each gazette is moved to printed on its own, so the family of exactly the ones that moved are told, once.
  const candidates = await FamilyGazetteItem.aggregate([{ $match: filter }, { $project: { _id: 1 } }]);
  let printed = 0;
  for (const candidate of candidates) {
    const done = await FamilyGazetteItem.findOneAndUpdate(
      { _id: candidate._id, status: Status.READY, pdfKey: { $ne: "" } },
      { $set: { status: Status.PRINTED, printedBy: actor._id, printedAt: now } },
      { new: true, lean: true },
    );
    if (!done) continue;
    printed += 1;
    await notifyPrinted({ item: done, actorId: actor._id });
  }
  return { printed };
};

/** Failed gazettes of the site's current issue are drawn again, with their content untouched. */
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

/**
 * Fix one resident's gazette and draw it again: take messages out for good (removeUploadIds), or choose exactly
 * which go in (uploadIds, at most the cap), then the PDF is redrawn. A printed gazette cannot be changed.
 */
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

/** The gazette is on paper. It must have been drawn first, and marking it twice changes nothing. */
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

/** The day the home gave the printed copy to the resident. Today unless a day is given; not in the future. */
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

// ---------------------------------------------------------------- reading the PDFs

const getPdf = async ({ organizationId, itemId }) => {
  await loadItemInOrganization({ organizationId, itemId });
  return getItemPdf({ itemId });
};

/** The PDFs to put in the zip: every drawn gazette of the issue each site is on, in resident order. */
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

/**
 * The zip, as a stream that starts flowing at once. Each PDF is read from storage one at a time and stored as it
 * is (PDFs do not compress); one that cannot be read is left out and logged rather than ending the download.
 */
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
