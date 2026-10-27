const { randomUUID } = require("crypto");
const { Resident } = require("@models/Resident");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItemStatus, FamilyUploadStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { prepareUpload } = require("./familyImage");
const { inTransaction } = require("./familyLinkActions");
const { toObjectId, isValidObjectId, joinOne } = require("./familyPipeline");

const MAX_PHOTOS = 10;
const MAX_MESSAGE_LENGTH = 500;
const MAX_CLIENT_ID_LENGTH = 100;
const REJECTED_KEEP_DAYS = 30;
const MAX_UNATTACHED_PHOTOS = 50;

const isDuplicateKey = (error) => error?.code === 11000;

const assertRoomForPhotos = async ({ userId, count }) => {
  const [waiting] = await FamilyMedia.aggregate([
    { $match: { uploadedBy: toObjectId(userId), uploadId: null, postId: null } },
    { $count: "count" },
  ]);
  if ((waiting?.count ?? 0) + count > MAX_UNATTACHED_PHOTOS) throw new AppError("too_many_unused_photos", 429);
};

const storePhoto = async ({ userId, image }) => {
  const { key, url } = await uploadAwsService.putObject({
    key: `family/${userId}/${randomUUID()}.jpg`,
    body: image.buffer,
    contentType: image.mimeType,
  });

  const media = await FamilyMedia.create({
    uploadedBy: userId,
    storageKey: key,
    url,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    size: image.size,
  });

  return { mediaId: media._id, url, width: image.width, height: image.height };
};

/** Up to 10 photos in one request. Every file is checked before any is stored, so one bad file stores nothing. */
const uploadPhotos = async ({ userId, files }) => {
  if (!Array.isArray(files) || !files.length) throw new AppError("file_required", 400);
  if (files.length > MAX_PHOTOS) throw new AppError("too_many_photos", 400);

  await assertRoomForPhotos({ userId, count: files.length });

  const images = [];
  for (const file of files) {
    try {
      images.push(await prepareUpload(file.buffer));
    } catch (error) {
      throw new AppError("invalid_image_file", 400, { file: file.originalname || "a file" });
    }
  }

  const photos = [];
  for (const image of images) photos.push(await storePhoto({ userId, image }));
  return { photos };
};

const uploadPhoto = async ({ userId, file }) => {
  if (!file) throw new AppError("file_required", 400);

  await assertRoomForPhotos({ userId, count: 1 });
  return storePhoto({ userId, image: await prepareUpload(file.buffer) });
};

const normaliseMessage = (message) => {
  const text = String(message ?? "").trim();
  if (text.length > MAX_MESSAGE_LENGTH) throw new AppError("message_too_long", 400);
  return text;
};

const normaliseMediaIds = (mediaIds) => {
  if (!Array.isArray(mediaIds)) throw new AppError("media_ids_invalid", 400);
  const unique = [...new Set(mediaIds.map(String))];
  if (unique.length > MAX_PHOTOS) throw new AppError("too_many_photos", 400);
  if (!unique.every(isValidObjectId)) throw new AppError("media_not_found", 400);
  return unique;
};

/** Photos can only be shared for a resident with photo sharing on; a message alone is always allowed. */
const assertPhotosAllowed = async ({ organizationId, residentId }) => {
  const [resident] = await Resident.aggregate([
    { $match: { _id: toObjectId(residentId), organizationId: toObjectId(organizationId) } },
    { $project: { photographyConsent: 1 } },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);
  if (!resident.photographyConsent) throw new AppError("photos_cannot_be_shared", 400);
};

const assertMediaUsable = async ({ userId, mediaIds, uploadId = null }) => {
  if (!mediaIds.length) return;

  const [found] = await FamilyMedia.aggregate([
    {
      $match: {
        _id: { $in: mediaIds.map(toObjectId) },
        uploadedBy: toObjectId(userId),
        uploadId: { $in: uploadId ? [null, toObjectId(uploadId)] : [null] },
      },
    },
    { $count: "count" },
  ]);
  if ((found?.count ?? 0) !== mediaIds.length) throw new AppError("media_not_found", 400);
};

const effectiveUrl = (field) => ({
  $cond: [{ $ne: [`$$media.blurredUrl`, ""] }, `$$media.blurredUrl`, `$$media.${field}`],
});

/** What the author sees: photos show the blurred copy once one exists. */
const TITLE_LENGTH = 60;

const STATUS_LABELS = {
  [FamilyUploadStatus.APPROVED]: "Approved",
  [FamilyUploadStatus.WAITING]: "Waiting For Approval",
  [FamilyUploadStatus.REJECTED]: "Not Approved",
};

/** The card heading: the message's first line, cut to fit. */
const firstLine = { $trim: { input: { $arrayElemAt: [{ $split: ["$message", "\n"] }, 0] } } };
const cardTitle = {
  $cond: [
    { $gt: [{ $strLenCP: firstLine }, TITLE_LENGTH] },
    { $concat: [{ $substrCP: [firstLine, 0, TITLE_LENGTH - 1] }, "…"] },
    firstLine,
  ],
};

const statusLabel = {
  $switch: {
    branches: Object.entries(STATUS_LABELS).map(([status, label]) => ({ case: { $eq: ["$status", status] }, then: label })),
    default: "",
  },
};

const myUploadStages = [
  { $lookup: { from: FamilyMedia.collection.name, localField: "mediaIds", foreignField: "_id", as: "media" } },
  ...joinOne({ from: Resident, localField: "residentId", as: "resident", optional: true }),
  {
    $addFields: {
      photos: {
        $map: { input: "$media", as: "media", in: { mediaId: "$$media._id", url: effectiveUrl("url") } },
      },
    },
  },
  {
    $project: {
      _id: 0,
      uploadId: "$_id",
      residentId: 1,
      residentName: { $ifNull: ["$resident.name", ""] },
      title: cardTitle,
      message: 1,
      photos: 1,
      includeInGazette: 1,
      status: 1,
      statusLabel,
      rejectionReason: 1,
      decidedAt: 1,
      createdAt: 1,
    },
  },
];

/**
 * Where an approved message meant for the gazette is: waiting for the next one, left for the next one because the
 * issue was full ("Moved to next gazette"), printed in an issue, or taken out by staff. Anything else has no place.
 */
const gazettePlacements = async (rows) => {
  const wanted = rows.filter((row) => row.status === FamilyUploadStatus.APPROVED && row.includeInGazette);
  if (!wanted.length) return new Map();

  const ids = wanted.map((row) => row.uploadId);
  const items = await FamilyGazetteItem.aggregate([
    { $match: { $or: [{ uploadIds: { $in: ids } }, { movedUploadIds: { $in: ids } }, { removedUploadIds: { $in: ids } }] } },
    ...joinOne({ from: FamilyGazetteIssue, localField: "issueId", as: "issue", optional: true }),
    { $sort: { "issue.number": -1 } },
    { $project: { status: 1, uploadIds: 1, movedUploadIds: 1, removedUploadIds: 1, issueNumber: { $ifNull: ["$issue.number", 0] } } },
  ]);

  const placements = new Map();
  wanted.forEach((row) => {
    const id = String(row.uploadId);
    const has = (list) => list.some((value) => String(value) === id);
    const item = items.find((entry) => has(entry.uploadIds) || has(entry.movedUploadIds) || has(entry.removedUploadIds));

    let placement = { status: "next", label: "In the next gazette", issueNumber: null };
    if (item && has(item.removedUploadIds)) placement = { status: "removed", label: "Not in the gazette", issueNumber: item.issueNumber };
    else if (item && has(item.movedUploadIds)) placement = { status: "moved", label: "Moved to next gazette", issueNumber: item.issueNumber };
    else if (item && has(item.uploadIds)) {
      placement = item.status === FamilyGazetteItemStatus.PRINTED
        ? { status: "printed", label: `In gazette no. ${item.issueNumber}`, issueNumber: item.issueNumber }
        : { status: "next", label: "In the next gazette", issueNumber: item.issueNumber };
    }
    placements.set(id, placement);
  });
  return placements;
};

const withGazette = async (rows) => {
  const placements = await gazettePlacements(rows);
  return rows.map((row) => ({ ...row, gazette: placements.get(String(row.uploadId)) ?? null }));
};

const statusCountsOf = (rows = []) => {
  const counts = Object.fromEntries(Object.values(FamilyUploadStatus).map((status) => [status, 0]));
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

const stillVisible = (now) => ({
  $or: [{ deleteAfter: null }, { deleteAfter: { $gt: now } }],
});

const listMyUploads = async ({ userId, residentId, status, page, limit, skip }) => {
  if (status && !Object.values(FamilyUploadStatus).includes(status)) {
    throw new AppError("invalid_status_filter", 400);
  }
  if (residentId && !isValidObjectId(residentId)) throw new AppError("resident_not_found", 404);

  const base = { authorId: toObjectId(userId), ...stillVisible(new Date()) };
  if (residentId) base.residentId = toObjectId(residentId);

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyUpload,
    match: status ? { ...base, status } : base,
    page,
    limit,
    skip,
    extraFacets: {
      statusCounts: [{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }],
    },
    extraDataStages: myUploadStages,
  });

  return { data: await withGazette(data), meta: { ...meta, counts: statusCountsOf(result.statusCounts) } };
};

const getMyUpload = async ({ userId, uploadId }) => {
  if (!isValidObjectId(uploadId)) throw new AppError("upload_not_found", 404);

  const [upload] = await FamilyUpload.aggregate([
    { $match: { _id: toObjectId(uploadId), authorId: toObjectId(userId) } },
    ...myUploadStages,
  ]);
  if (!upload) throw new AppError("upload_not_found", 404);
  return (await withGazette([upload]))[0];
};

/** Send For Approval. The same clientId returns the upload already made instead of a second one. */
const createUpload = async ({ userId, link, message, mediaIds = [], includeInGazette, clientId }) => {
  const cleanClientId = clientId == null ? null : String(clientId).slice(0, MAX_CLIENT_ID_LENGTH);

  if (cleanClientId) {
    const [existing] = await FamilyUpload.aggregate([
      { $match: { authorId: toObjectId(userId), clientId: cleanClientId } },
      { $project: { _id: 1 } },
    ]);
    if (existing) return getMyUpload({ userId, uploadId: existing._id });
  }

  const text = normaliseMessage(message);
  const ids = normaliseMediaIds(mediaIds);
  if (!text && !ids.length) throw new AppError("upload_empty", 400);

  if (ids.length) {
    await assertPhotosAllowed({ organizationId: link.organizationId, residentId: link.residentId });
    await assertMediaUsable({ userId, mediaIds: ids });
  }

  let created;
  try {
    await inTransaction(async (session) => {
      [created] = await FamilyUpload.create(
        [
          {
            organizationId: link.organizationId,
            branchId: link.branchId,
            residentId: link.residentId,
            authorId: userId,
            message: text,
            mediaIds: ids.map(toObjectId),
            includeInGazette: Boolean(includeInGazette),
            clientId: cleanClientId,
          },
        ],
        { session }
      );

      if (ids.length) {
        const attached = await FamilyMedia.updateMany(
          { _id: { $in: ids.map(toObjectId) }, uploadedBy: userId, uploadId: null },
          { $set: { uploadId: created._id } },
          { session }
        );
        if (attached.modifiedCount !== ids.length) throw new AppError("media_not_found", 400);
      }
    });
  } catch (error) {
    if (isDuplicateKey(error) && cleanClientId) {
      const [existing] = await FamilyUpload.aggregate([
        { $match: { authorId: toObjectId(userId), clientId: cleanClientId } },
        { $project: { _id: 1 } },
      ]);
      return getMyUpload({ userId, uploadId: existing._id });
    }
    throw error;
  }

  return getMyUpload({ userId, uploadId: created._id });
};

/**
 * Edit And Resend: a Waiting or Not Approved upload goes back to Waiting. An approved one is final.
 * `links` are the caller's active links, so a removed member can no longer edit.
 */
const updateUpload = async ({ userId, links, uploadId, message, mediaIds, includeInGazette }) => {
  if (!isValidObjectId(uploadId)) throw new AppError("upload_not_found", 404);

  const [current] = await FamilyUpload.aggregate([
    { $match: { _id: toObjectId(uploadId), authorId: toObjectId(userId) } },
    { $project: { organizationId: 1, residentId: 1, message: 1, mediaIds: 1, includeInGazette: 1, status: 1 } },
  ]);
  const link = current && links.find((l) => String(l.residentId) === String(current.residentId));
  if (!link) throw new AppError("upload_not_found", 404);
  if (current.status === FamilyUploadStatus.APPROVED) throw new AppError("upload_not_editable", 409);

  const text = message === undefined ? current.message : normaliseMessage(message);
  const ids = mediaIds === undefined ? current.mediaIds.map(String) : normaliseMediaIds(mediaIds);
  if (!text && !ids.length) throw new AppError("upload_empty", 400);

  if (ids.length) {
    await assertPhotosAllowed({ organizationId: link.organizationId, residentId: link.residentId });
    await assertMediaUsable({ userId, mediaIds: ids, uploadId });
  }

  await inTransaction(async (session) => {
    const updated = await FamilyUpload.updateOne(
      {
        _id: current._id,
        authorId: toObjectId(userId),
        status: { $in: [FamilyUploadStatus.WAITING, FamilyUploadStatus.REJECTED] },
      },
      {
        $set: {
          message: text,
          mediaIds: ids.map(toObjectId),
          includeInGazette: includeInGazette === undefined ? current.includeInGazette : Boolean(includeInGazette),
          status: FamilyUploadStatus.WAITING,
          rejectionReason: "",
          decidedBy: null,
          decidedAt: null,
          deleteAfter: null,
        },
      },
      { session }
    );
    if (!updated.modifiedCount) throw new AppError("upload_not_editable", 409);

    await FamilyMedia.updateMany(
      { uploadId: current._id, _id: { $nin: ids.map(toObjectId) } },
      { $set: { uploadId: null } },
      { session }
    );
    if (ids.length) {
      await FamilyMedia.updateMany(
        { _id: { $in: ids.map(toObjectId) }, uploadedBy: userId },
        { $set: { uploadId: current._id } },
        { session }
      );
    }
  });

  return getMyUpload({ userId, uploadId });
};

const rejectedDeleteAfter = (from = new Date()) =>
  new Date(from.getTime() + REJECTED_KEEP_DAYS * 24 * 60 * 60 * 1000);

module.exports = {
  uploadPhoto,
  uploadPhotos,
  listMyUploads,
  createUpload,
  updateUpload,
  rejectedDeleteAfter,
};
