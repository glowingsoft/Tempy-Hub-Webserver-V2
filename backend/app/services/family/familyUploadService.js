const { randomUUID } = require("crypto");
const { Resident } = require("@models/Resident");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyUploadStatus } = require("@models/domainEnums");
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

const isDuplicateKey = (error) => error?.code === 11000;

// ---------------------------------------------------------------- photos

/** Step before submitting: the photo is checked, resized and stored, and the app keeps the returned mediaId. */
const uploadPhoto = async ({ userId, file }) => {
  if (!file) throw new AppError("file_required", 400);

  const image = await prepareUpload(file.buffer);
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

// ---------------------------------------------------------------- validation

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

/** Photos must be the caller's own and not already used by another upload. */
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

// ---------------------------------------------------------------- reading

const effectiveUrl = (field) => ({
  $cond: [{ $ne: [`$$media.blurredUrl`, ""] }, `$$media.blurredUrl`, `$$media.${field}`],
});

/** What the author sees: photos show the blurred copy once one exists. */
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
      message: 1,
      photos: 1,
      includeInGazette: 1,
      status: 1,
      rejectionReason: 1,
      decidedAt: 1,
      createdAt: 1,
    },
  },
];

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

/** My Uploads: Approved, Waiting For Approval and Not Approved, newest first. Rejected ones leave after 30 days. */
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

  return { data, meta: { ...meta, counts: statusCountsOf(result.statusCounts) } };
};

const getMyUpload = async ({ userId, uploadId }) => {
  if (!isValidObjectId(uploadId)) throw new AppError("upload_not_found", 404);

  const [upload] = await FamilyUpload.aggregate([
    { $match: { _id: toObjectId(uploadId), authorId: toObjectId(userId) } },
    ...myUploadStages,
  ]);
  if (!upload) throw new AppError("upload_not_found", 404);
  return upload;
};

// ---------------------------------------------------------------- writing

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
  listMyUploads,
  getMyUpload,
  createUpload,
  updateUpload,
  rejectedDeleteAfter,
  MAX_PHOTOS,
  MAX_MESSAGE_LENGTH,
};
