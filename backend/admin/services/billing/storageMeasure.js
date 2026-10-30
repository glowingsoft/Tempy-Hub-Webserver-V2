const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { StaffProfile } = require("@models/StaffProfile");
const { FloorPlan } = require("@models/FloorPlan");
const { ResidentMedia } = require("@models/ResidentMedia");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyPost } = require("@models/FamilyPost");
const { Document } = require("@models/Document");
const { DocumentVersion } = require("@models/DocumentVersion");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { StoredObject } = require("@models/StoredObject");
const { keyFromUrl } = require("@utils/s3Key");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { toObjectId } = require("@appServices/family/familyPipeline");

const IMAGE = "image";
const FILE = "file";
const HEAD_CONCURRENCY = 10;
const LOOKUP_CHUNK = 1000;
const SAVE_CHUNK = 500;

const chunksOf = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

const inPool = async (items, limit, work) => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

const urlKey = (url) =>
  keyFromUrl(url, { bucket: process.env.S3_BUCKET_NAME });

const refs = (kind, branchId, ...keys) =>
  keys
    .filter(Boolean)
    .map((key) => ({ key, kind, branchId: branchId ? String(branchId) : null }));

const familyMediaOf = (model, organizationId) =>
  model.aggregate([
    { $match: { organizationId, "mediaIds.0": { $exists: true } } },
    {
      $lookup: {
        from: FamilyMedia.collection.name,
        localField: "mediaIds",
        foreignField: "_id",
        as: "media",
      },
    },
    { $unwind: "$media" },
    {
      $project: {
        _id: 0,
        branchId: "$branchId",
        storageKey: "$media.storageKey",
        blurredKey: "$media.blurredKey",
        size: "$media.size",
      },
    },
  ]);

/** Every stored file the organization's records point to, once each, as { key, kind, size? }. */
const gatherReferences = async (organizationId) => {
  const organization = toObjectId(organizationId);
  const branches = await Branch.aggregate([
    { $match: { organizationId: organization } },
    { $project: { _id: 1 } },
  ]);

  const [
    residents,
    staff,
    plans,
    residentMedia,
    uploadMedia,
    postMedia,
    documents,
    newsletters,
    gazettes,
  ] = await Promise.all([
    Resident.aggregate([
      { $match: { organizationId: organization } },
      { $project: { photoUrl: 1, branchId: 1 } },
    ]),
    StaffProfile.aggregate([
      { $match: { organizationId: organization } },
      { $project: { photoUrl: 1, bannerUrl: 1, branchId: 1 } },
    ]),
    FloorPlan.aggregate([
      { $match: { organizationId: organization } },
      { $project: { imageUrl: 1, pdfUrl: 1, branchId: 1 } },
    ]),
    ResidentMedia.aggregate([
      { $match: { branchId: { $in: branches.map((branch) => branch._id) } } },
      { $project: { url: 1, thumbnailUrl: 1, branchId: 1 } },
    ]),
    familyMediaOf(FamilyUpload, organization),
    familyMediaOf(FamilyPost, organization),
    Document.aggregate([
      { $match: { organizationId: organization } },
      {
        $lookup: {
          from: DocumentVersion.collection.name,
          localField: "_id",
          foreignField: "documentId",
          as: "version",
        },
      },
      { $unwind: "$version" },
      { $project: { _id: 0, branchId: "$branchId", fileUrl: "$version.fileUrl" } },
    ]),
    FamilyNewsletter.aggregate([
      { $match: { organizationId: organization } },
      { $project: { pdfKey: 1, branchId: 1 } },
    ]),
    FamilyGazetteItem.aggregate([
      { $match: { organizationId: organization } },
      { $project: { pdfKey: 1, branchId: 1 } },
    ]),
  ]);

  const found = [
    ...residents.flatMap((row) => refs(IMAGE, row.branchId, urlKey(row.photoUrl))),
    ...staff.flatMap((row) =>
      refs(IMAGE, row.branchId, urlKey(row.photoUrl), urlKey(row.bannerUrl)),
    ),
    ...plans.flatMap((row) => [
      ...refs(IMAGE, row.branchId, urlKey(row.imageUrl)),
      ...refs(FILE, row.branchId, urlKey(row.pdfUrl)),
    ]),
    ...residentMedia.flatMap((row) =>
      refs(IMAGE, row.branchId, urlKey(row.url), urlKey(row.thumbnailUrl)),
    ),
    ...[...uploadMedia, ...postMedia].flatMap((row) => [
      ...refs(IMAGE, row.branchId, row.storageKey).map((ref) => ({ ...ref, size: row.size })),
      ...refs(IMAGE, row.branchId, row.blurredKey),
    ]),
    ...documents.flatMap((row) => refs(FILE, row.branchId, urlKey(row.fileUrl))),
    ...newsletters.flatMap((row) => refs(FILE, row.branchId, row.pdfKey)),
    ...gazettes.flatMap((row) => refs(FILE, row.branchId, row.pdfKey)),
  ];
  return [...new Map(found.map((ref) => [ref.key, ref])).values()];
};

/** Sizes by key: null for a file the bucket does not have; absent for one that could not be measured now. */
const sizesOf = async (references) => {
  const sizes = new Map();
  const unknown = [];
  references.forEach((ref) =>
    ref.size > 0 ? sizes.set(ref.key, ref.size) : unknown.push(ref.key),
  );

  for (const chunk of chunksOf(unknown, LOOKUP_CHUNK)) {
    const cached = await StoredObject.aggregate([
      { $match: { key: { $in: chunk } } },
      { $project: { key: 1, size: 1, missing: 1 } },
    ]);
    cached.forEach((row) => sizes.set(row.key, row.missing ? null : row.size));
  }

  const toMeasure = unknown.filter((key) => !sizes.has(key));
  const measured = new Map();
  await inPool(toMeasure, HEAD_CONCURRENCY, async (key) => {
    try {
      const head = await uploadAwsService.headObject(key);
      measured.set(key, head ? head.size : null);
    } catch (error) {
      console.error("storage size lookup failed", key, error.message);
    }
  });

  for (const chunk of chunksOf([...measured], SAVE_CHUNK)) {
    await StoredObject.bulkWrite(
      chunk.map(([key, size]) => ({
        updateOne: {
          filter: { key },
          update: {
            $set: { size: size ?? 0, missing: size === null, measuredAt: new Date() },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  measured.forEach((size, key) => sizes.set(key, size));
  return sizes;
};

const emptyFigures = () => ({ imageBytes: 0, imageCount: 0, fileBytes: 0, fileCount: 0 });

const measureOrganization = async (organizationId) => {
  const [references, branches] = await Promise.all([
    gatherReferences(organizationId),
    Branch.aggregate([
      { $match: { organizationId: toObjectId(organizationId) } },
      { $project: { _id: 1 } },
    ]),
  ]);
  const sizes = await sizesOf(references);

  const totals = { ...emptyFigures(), unmeasured: 0 };
  const byBranch = new Map(branches.map((branch) => [String(branch._id), emptyFigures()]));
  references.forEach(({ key, kind, branchId }) => {
    if (!sizes.has(key)) {
      totals.unmeasured += 1;
      return;
    }
    const size = sizes.get(key);
    if (size === null) return;
    totals[`${kind}Bytes`] += size;
    totals[`${kind}Count`] += 1;
    const branch = byBranch.get(branchId);
    if (branch) {
      branch[`${kind}Bytes`] += size;
      branch[`${kind}Count`] += 1;
    }
  });
  return {
    ...totals,
    branches: [...byBranch].map(([branchId, figures]) => ({ branchId, ...figures })),
  };
};

module.exports = { gatherReferences, sizesOf, measureOrganization };
