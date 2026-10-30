const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const {
  AdmissionStatus,
  FamilyGazetteIssueStatus,
  FamilyGazetteItemStatus,
  FamilyMemberStatus,
  FamilyUploadStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { publishedPostsOfSite } = require("./familyPostFilters");
const { getGazetteRules } = require("./familySettingsService");
const {
  currentPeriod,
  lastClosedPeriod,
  manualPeriod,
} = require("./familyGazettePeriod");

const MAX_LIFE_POSTS = 6;
const NUMBER_RETRIES = 3;
const isDuplicateKey = (error) => error?.code === 11000;

// The schedule builds the issue that just closed; a manager asking by hand gets the one open now.
const choosePeriod = ({
  rules,
  timezone,
  at = new Date(),
  scheduled = false,
}) => {
  const options = {
    anchorDate: rules.anchorDate,
    issueEveryDays: rules.issueEveryDays,
    timezone,
    at,
  };
  if (scheduled) return rules.configured ? lastClosedPeriod(options) : null;
  return rules.configured ? currentPeriod(options) : manualPeriod(options);
};

const idOf = (value) => String(value);

// Wall posts alone do not make a gazette: no family or no messages means no PDF. Messages are approved, sent before the close, and not already used or taken out.
const selectContent = ({
  cap,
  familyCount,
  uploads,
  usedUploadIds,
  removedUploadIds,
  posts,
  chosenUploadIds = null,
}) => {
  const used = new Set([...usedUploadIds, ...removedUploadIds].map(idOf));
  const eligible = uploads
    .filter((upload) => !used.has(idOf(upload._id)))
    .sort(
      (a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt) ||
        idOf(b._id).localeCompare(idOf(a._id)),
    );

  const chosen = chosenUploadIds ? new Set(chosenUploadIds.map(idOf)) : null;
  const included = chosen
    ? eligible.filter((upload) => chosen.has(idOf(upload._id)))
    : eligible.slice(0, cap);
  const moved = chosen
    ? eligible.filter((upload) => !chosen.has(idOf(upload._id)))
    : eligible.slice(cap);
  const life = [...posts]
    .sort(
      (a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt) ||
        idOf(b._id).localeCompare(idOf(a._id)),
    )
    .slice(0, MAX_LIFE_POSTS);

  const status = !familyCount
    ? FamilyGazetteItemStatus.NO_FAMILY
    : !eligible.length
      ? FamilyGazetteItemStatus.NO_CONTENT
      : FamilyGazetteItemStatus.BUILDING;
  const hasGazette = status === FamilyGazetteItemStatus.BUILDING;

  return {
    status,
    uploadIds: hasGazette ? included.map((upload) => upload._id) : [],
    movedUploadIds: hasGazette ? moved.map((upload) => upload._id) : [],
    postIds: hasGazette ? life.map((post) => post._id) : [],
    messageCount: eligible.length,
    overCap: eligible.length > cap,
    familyCount,
  };
};

const group = (rows, key) => {
  const map = new Map();
  rows.forEach((row) => {
    const id = idOf(row[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  });
  return map;
};

const gather = async ({
  organizationId,
  branchId,
  period,
  issueId,
  onlyResidentId = null,
}) => {
  const org = toObjectId(organizationId);
  const branch = toObjectId(branchId);

  const residents = await Resident.aggregate([
    {
      $match: {
        organizationId: org,
        branchId: branch,
        admissionStatus: AdmissionStatus.ADMITTED,
        ...(onlyResidentId ? { _id: toObjectId(onlyResidentId) } : {}),
      },
    },
    { $project: { name: 1, roomNumber: 1 } },
  ]);
  const residentIds = residents.map((resident) => resident._id);

  const [families, uploads, others, posts] = await Promise.all([
    FamilyMember.aggregate([
      {
        $match: {
          organizationId: org,
          branchId: branch,
          residentId: { $in: residentIds },
          status: FamilyMemberStatus.ACTIVE,
        },
      },
      { $group: { _id: "$residentId", count: { $sum: 1 } } },
    ]),
    FamilyUpload.aggregate([
      {
        $match: {
          organizationId: org,
          branchId: branch,
          residentId: { $in: residentIds },
          status: FamilyUploadStatus.APPROVED,
          includeInGazette: true,
          createdAt: { $lte: period.end },
        },
      },
      { $project: { residentId: 1, createdAt: 1 } },
    ]),
    FamilyGazetteItem.aggregate([
      {
        $match: { residentId: { $in: residentIds }, issueId: { $ne: issueId } },
      },
      { $project: { residentId: 1, uploadIds: 1, removedUploadIds: 1 } },
    ]),
    FamilyPost.aggregate([
      ...publishedPostsOfSite({
        organizationId,
        branchId,
        includeTagged: true,
      }),
      {
        $match: {
          createdAt: { $gte: period.start, $lte: period.end },
          taggedResidentIds: { $in: residentIds },
        },
      },
      { $project: { createdAt: 1, taggedResidentIds: 1 } },
    ]),
  ]);

  const postsByResident = new Map();
  posts.forEach((post) => {
    post.taggedResidentIds.forEach((residentId) => {
      if (!postsByResident.has(idOf(residentId)))
        postsByResident.set(idOf(residentId), []);
      postsByResident.get(idOf(residentId)).push(post);
    });
  });

  return {
    residents,
    familyCounts: new Map(families.map((row) => [idOf(row._id), row.count])),
    uploadsByResident: group(uploads, "residentId"),
    earlierByResident: group(others, "residentId"),
    postsByResident,
  };
};

const nextNumber = async (branchId) => {
  const [row] = await FamilyGazetteIssue.aggregate([
    { $match: { branchId: toObjectId(branchId) } },
    { $group: { _id: null, latest: { $max: "$number" } } },
  ]);
  return (row?.latest ?? 0) + 1;
};

const findIssue = async ({ branchId, periodStart }) => {
  const [issue] = await FamilyGazetteIssue.aggregate([
    { $match: { branchId: toObjectId(branchId), periodStart } },
  ]);
  return issue || null;
};

const openIssue = async ({ organizationId, branchId, period, cap, actor }) => {
  const existing = await findIssue({ branchId, periodStart: period.start });
  if (existing) return existing;

  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt += 1) {
    try {
      const created = await FamilyGazetteIssue.create({
        organizationId,
        branchId,
        number: await nextNumber(branchId),
        periodStart: period.start,
        periodEnd: period.end,
        closesAt: period.closesAt,
        messageCap: cap,
        generatedBy: actor?._id ?? null,
        status: FamilyGazetteIssueStatus.BUILDING,
      });
      return created.toObject ? created.toObject() : created;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await findIssue({ branchId, periodStart: period.start });
      if (raced) return raced;
    }
  }
  throw new AppError("gazette_issue_busy", 409);
};

// Content is stored before any PDF so a failed render can be retried; printed gazettes are never changed.
const generateIssue = async ({
  organizationId,
  branchId,
  period,
  actor = null,
  now = new Date(),
}) => {
  if (!period) throw new AppError("gazette_period_required", 400);

  const rules = await getGazetteRules({ organizationId });
  const issue = await openIssue({
    organizationId,
    branchId,
    period,
    cap: rules.messageCap,
    actor,
  });
  const cap = issue.messageCap;

  const data = await gather({
    organizationId,
    branchId,
    period,
    issueId: issue._id,
  });
  const existing = await FamilyGazetteItem.aggregate([
    { $match: { issueId: issue._id } },
  ]);
  const byResident = new Map(
    existing.map((item) => [idOf(item.residentId), item]),
  );

  const operations = [];
  const counts = Object.fromEntries(
    Object.values(FamilyGazetteItemStatus).map((status) => [status, 0]),
  );
  let overCap = 0;

  data.residents.forEach((resident) => {
    const id = idOf(resident._id);
    const current = byResident.get(id);
    if (current?.status === FamilyGazetteItemStatus.PRINTED) {
      counts[FamilyGazetteItemStatus.PRINTED] += 1;
      return;
    }

    const content = selectContent({
      cap,
      familyCount: data.familyCounts.get(id) ?? 0,
      uploads: data.uploadsByResident.get(id) ?? [],
      usedUploadIds: (data.earlierByResident.get(id) ?? []).flatMap((item) => [
        ...item.uploadIds,
      ]),
      removedUploadIds: [
        ...(current?.removedUploadIds ?? []),
        ...(data.earlierByResident.get(id) ?? []).flatMap((item) => [
          ...item.removedUploadIds,
        ]),
      ],
      posts: data.postsByResident.get(id) ?? [],
    });
    counts[content.status] += 1;
    if (content.overCap) overCap += 1;

    operations.push({
      updateOne: {
        filter: { issueId: issue._id, residentId: resident._id },
        update: {
          $set: {
            ...content,
            organizationId: toObjectId(organizationId),
            branchId: toObjectId(branchId),
            pdfKey: "",
            failureReason: "",
            generatedAt: now,
          },
          $setOnInsert: { removedUploadIds: [] },
        },
        upsert: true,
      },
    });
  });

  if (operations.length)
    await FamilyGazetteItem.bulkWrite(operations, { ordered: false });
  await FamilyGazetteIssue.updateOne(
    { _id: issue._id },
    { $set: { generatedAt: now, messageCap: cap } },
  );

  return { issue, residents: data.residents.length, counts, overCap };
};

// Messages taken out stay out; a chosen list must be unused messages within the cap.
const rebuildItem = async ({
  item,
  issue,
  removeUploadIds = [],
  chosenUploadIds = null,
  now = new Date(),
}) => {
  const period = { start: issue.periodStart, end: issue.periodEnd };
  const data = await gather({
    organizationId: item.organizationId,
    branchId: item.branchId,
    period,
    issueId: issue._id,
    onlyResidentId: item.residentId,
  });
  const id = idOf(item.residentId);
  const uploads = data.uploadsByResident.get(id) ?? [];
  const earlier = data.earlierByResident.get(id) ?? [];

  const known = new Set([...item.uploadIds, ...item.movedUploadIds].map(idOf));
  const removing = removeUploadIds.map(idOf);
  if (removing.some((uploadId) => !known.has(uploadId)))
    throw new AppError("gazette_upload_invalid", 400);
  const removed = [
    ...new Set([...(item.removedUploadIds ?? []).map(idOf), ...removing]),
  ];

  const available = new Set(uploads.map((upload) => idOf(upload._id)));
  if (chosenUploadIds) {
    const chosen = chosenUploadIds.map(idOf);
    if (
      new Set(chosen).size !== chosen.length ||
      chosen.length > issue.messageCap ||
      chosen.some(
        (uploadId) => !available.has(uploadId) || removed.includes(uploadId),
      )
    ) {
      throw new AppError("gazette_selection_invalid", 400, {
        cap: issue.messageCap,
      });
    }
  }

  const content = selectContent({
    cap: issue.messageCap,
    familyCount: data.familyCounts.get(id) ?? 0,
    uploads,
    usedUploadIds: earlier.flatMap((row) => [...row.uploadIds]),
    removedUploadIds: [
      ...removed,
      ...earlier.flatMap((row) => [...row.removedUploadIds]),
    ],
    posts: data.postsByResident.get(id) ?? [],
    chosenUploadIds: chosenUploadIds,
  });

  const saved = await FamilyGazetteItem.updateOne(
    { _id: item._id, status: { $ne: FamilyGazetteItemStatus.PRINTED } },
    {
      $set: {
        ...content,
        removedUploadIds: removed.map(toObjectId),
        pdfKey: "",
        failureReason: "",
        generatedAt: now,
      },
    },
  );
  if (!saved.matchedCount) throw new AppError("gazette_already_printed", 409);
  return content;
};

module.exports = {
  choosePeriod,
  selectContent,
  generateIssue,
  rebuildItem,
  MAX_LIFE_POSTS,
};
