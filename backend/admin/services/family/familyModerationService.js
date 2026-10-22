const { randomUUID } = require("crypto");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyMedia } = require("@models/FamilyMedia");
const { NotificationExp } = require("@models/Notifications");
const { FamilyUploadStatus } = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { actorStanding, assertMayAccessResidents } = require("@adminServices/residents/residentAccess");
const { blurAreas, validateAreas } = require("@appServices/family/familyImage");
const { rejectedDeleteAfter } = require("@appServices/family/familyUploadService");
const { toObjectId, isValidObjectId, joinOne } = require("@appServices/family/familyPipeline");

const MAX_REASON_LENGTH = 500;

const statusCountsOf = (rows = []) => {
  const counts = Object.fromEntries(Object.values(FamilyUploadStatus).map((status) => [status, 0]));
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

const queueStages = [
  { $lookup: { from: FamilyMedia.collection.name, localField: "mediaIds", foreignField: "_id", as: "media" } },
  ...joinOne({ from: Resident, localField: "residentId", as: "resident", optional: true }),
  ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
  ...joinOne({ from: User, localField: "decidedBy", as: "decider", optional: true }),
  {
    $addFields: {
      photos: {
        $map: {
          input: "$media",
          as: "media",
          in: {
            mediaId: "$$media._id",
            url: "$$media.url",
            blurredUrl: "$$media.blurredUrl",
            width: "$$media.width",
            height: "$$media.height",
          },
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      uploadId: "$_id",
      residentId: 1,
      branchId: 1,
      residentName: { $ifNull: ["$resident.name", ""] },
      roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
      authorId: 1,
      authorName: { $ifNull: ["$author.name", ""] },
      authorEmail: { $ifNull: ["$author.email", ""] },
      message: 1,
      photos: 1,
      includeInGazette: 1,
      status: 1,
      rejectionReason: 1,
      decidedByName: { $ifNull: ["$decider.name", ""] },
      decidedAt: 1,
      createdAt: 1,
    },
  },
];

/** The queue shows what is waiting by default; meta.counts covers every status and ignores the status filter. */
const listUploads = async ({ organizationId, branchId, residentId, status, page, limit, skip }) => {
  const wanted = status || FamilyUploadStatus.WAITING;
  if (!Object.values(FamilyUploadStatus).includes(wanted)) throw new AppError("invalid_status_filter", 400);

  const base = { organizationId: toObjectId(organizationId) };
  if (branchId) base.branchId = toObjectId(branchId);
  if (residentId) base.residentId = toObjectId(residentId);

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyUpload,
    match: { ...base, status: wanted },
    page,
    limit,
    skip,
    sort: { createdAt: wanted === FamilyUploadStatus.WAITING ? 1 : -1 },
    extraFacets: {
      statusCounts: [{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }],
    },
    extraDataStages: queueStages,
  });

  return { data, meta: { ...meta, counts: statusCountsOf(result.statusCounts) } };
};

// ---------------------------------------------------------------- deciding

/** Another manager may have decided first; a site or line manager can only decide for their own site. */
const loadWaitingUpload = async ({ actor, organizationId, uploadId }) => {
  if (!isValidObjectId(uploadId)) throw new AppError("upload_not_found", 404);

  const [upload] = await FamilyUpload.aggregate([
    { $match: { _id: toObjectId(uploadId), organizationId: toObjectId(organizationId) } },
    { $project: { branchId: 1, residentId: 1, authorId: 1, status: 1, mediaIds: 1 } },
  ]);
  if (!upload) throw new AppError("upload_not_found", 404);

  assertMayAccessResidents(await actorStanding(actor, organizationId), upload.branchId);

  if (upload.status !== FamilyUploadStatus.WAITING) {
    throw new AppError("upload_already_decided", 409, { status: upload.status });
  }
  return upload;
};

/** The status is part of the filter, so two managers deciding at once cannot both win. */
const settle = async ({ upload, actor, set }) => {
  const result = await FamilyUpload.updateOne(
    { _id: upload._id, status: FamilyUploadStatus.WAITING },
    { $set: { decidedBy: actor._id, decidedAt: new Date(), ...set } }
  );
  if (!result.modifiedCount) throw new AppError("upload_already_decided", 409);
};

const notifyAuthor = async ({ upload, actor, type, title, body }) => {
  try {
    await NotificationExp.create({
      type,
      subjectId: actor._id,
      objectId: upload._id,
      objectType: "familyUpload",
      receiverId: upload.authorId,
      title,
      body,
    });
  } catch (error) {
    console.error("family upload notification failed", error.message);
  }
};

/** `areas` maps a photo id of this upload to the rectangles to blur, as fractions of the photo. */
const saveBlurredCopies = async ({ upload, areas }) => {
  const mediaIds = new Set(upload.mediaIds.map(String));
  const entries = Object.entries(areas || {});
  if (areas && (typeof areas !== "object" || Array.isArray(areas))) throw new AppError("invalid_blur_areas", 400);

  entries.forEach(([mediaId, rectangles]) => {
    if (!mediaIds.has(mediaId)) throw new AppError("invalid_blur_areas", 400);
    validateAreas(rectangles);
  });

  for (const [mediaId, rectangles] of entries) {
    const [media] = await FamilyMedia.aggregate([
      { $match: { _id: toObjectId(mediaId) } },
      { $project: { storageKey: 1 } },
    ]);
    const original = await uploadAwsService.getObject(media.storageKey);
    const blurred = await blurAreas(original, rectangles);
    const { key, url } = await uploadAwsService.putObject({
      key: `family/blurred/${randomUUID()}.jpg`,
      body: blurred.buffer,
      contentType: blurred.mimeType,
    });
    await FamilyMedia.updateOne({ _id: media._id }, { $set: { blurredKey: key, blurredUrl: url } });
  }
};

const approveUpload = async ({ actor, organizationId, uploadId, blur }) => {
  const upload = await loadWaitingUpload({ actor, organizationId, uploadId });

  await saveBlurredCopies({ upload, areas: blur });
  await settle({
    upload,
    actor,
    set: { status: FamilyUploadStatus.APPROVED, rejectionReason: "", deleteAfter: null },
  });

  await notifyAuthor({
    upload,
    actor,
    type: "familyUploadApproved",
    title: "Upload approved",
    body: "Your photos and message are now shared with the family.",
  });
  return { uploadId: upload._id, status: FamilyUploadStatus.APPROVED };
};

const rejectUpload = async ({ actor, organizationId, uploadId, reason }) => {
  const text = String(reason ?? "").trim();
  if (!text) throw new AppError("reason_required", 400);
  if (text.length > MAX_REASON_LENGTH) throw new AppError("reason_too_long", 400);

  const upload = await loadWaitingUpload({ actor, organizationId, uploadId });
  await settle({
    upload,
    actor,
    set: { status: FamilyUploadStatus.REJECTED, rejectionReason: text, deleteAfter: rejectedDeleteAfter() },
  });

  await notifyAuthor({
    upload,
    actor,
    type: "familyUploadRejected",
    title: "Upload not approved",
    body: text,
  });
  return { uploadId: upload._id, status: FamilyUploadStatus.REJECTED };
};

module.exports = { listUploads, approveUpload, rejectUpload };
