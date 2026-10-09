const mongoose = require("mongoose");
const { ResidentMedia } = require("@models/ResidentMedia");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { paginateWithFacet } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const { ResidentMediaReviewStatus } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/staff/staffAccess");

const REVIEW_DECISIONS = {
  approved: ResidentMediaReviewStatus.APPROVED,
  rejected: ResidentMediaReviewStatus.REJECTED,
};

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const parseReviewStatus = (value) => {
  if (value == null || value === "" || value === "all") return undefined;
  const status = String(value).trim();
  if (!Object.values(ResidentMediaReviewStatus).includes(status)) {
    throw new AppError("invalid_media_review_status", 400);
  }
  return status;
};

const parseDecision = (value) => {
  const next = REVIEW_DECISIONS[String(value || "").trim()];
  if (!next) throw new AppError("invalid_media_review_decision", 400);
  return next;
};

const listResidentMedia = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  status,
  residentId,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayManageStaff(standing, scopedBranchId);

  const branchFilter = {
    organizationId: toObjectId(organizationId),
  };
  if (scopedBranchId) branchFilter._id = toObjectId(scopedBranchId);

  const branchIds = await Branch.find(branchFilter).distinct("_id");
  if (!branchIds.length) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }

  const match = { branchId: { $in: branchIds } };
  const statusFilter = String(status || "").trim();
  if (statusFilter !== "all") {
    const reviewStatus = parseReviewStatus(statusFilter || ResidentMediaReviewStatus.PENDING);
    match.reviewStatus =
      reviewStatus === ResidentMediaReviewStatus.PENDING
        ? { $in: [ResidentMediaReviewStatus.PENDING, null] }
        : reviewStatus;
  }

  if (residentId) match.residentId = toObjectId(residentId);

  const extraDataStages = [
    {
      $lookup: {
        from: Resident.collection.name,
        localField: "residentId",
        foreignField: "_id",
        as: "_resident",
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "uploadedBy",
        foreignField: "_id",
        as: "_uploader",
      },
    },
    {
      $addFields: {
        resident: {
          $let: {
            vars: { r: { $arrayElemAt: ["$_resident", 0] } },
            in: {
              _id: "$$r._id",
              name: "$$r.name",
              roomNumber: "$$r.roomNumber",
              photographyConsent: { $eq: ["$$r.photographyConsent", true] },
            },
          },
        },
        uploadedByUser: {
          $let: {
            vars: { u: { $arrayElemAt: ["$_uploader", 0] } },
            in: {
              _id: "$$u._id",
              name: "$$u.name",
            },
          },
        },
      },
    },
    {
      $addFields: {
        blocked: {
          $not: {
            $and: ["$resident.photographyConsent", { $eq: ["$consentVerified", true] }],
          },
        },
      },
    },
    { $project: { _resident: 0, _uploader: 0 } },
  ];

  return paginateWithFacet({
    model: ResidentMedia,
    match,
    page,
    limit,
    skip,
    extraDataStages,
  });
};

const reviewResidentMedia = async ({
  actor,
  organizationId,
  mediaId,
  decision,
  reason,
}) => {
  const nextStatus = parseDecision(decision);
  const media = await ResidentMedia.findById(mediaId);
  if (!media) throw new AppError("resident_media_not_found", 404);

  await assertBranchInOrganization(media.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, media.branchId);

  const current = media.reviewStatus || ResidentMediaReviewStatus.PENDING;
  if (current !== ResidentMediaReviewStatus.PENDING) {
    throw new AppError("media_already_reviewed", 409);
  }

  const resident = await Resident.findOne({
    _id: media.residentId,
    organizationId,
  })
    .select("_id name roomNumber photographyConsent")
    .lean();
  if (!resident) throw new AppError("resident_not_found", 404);

  if (nextStatus === ResidentMediaReviewStatus.APPROVED) {
    if (!resident.photographyConsent || !media.consentVerified) {
      throw new AppError("photography_consent_required", 400);
    }
  }

  const reviewReason =
    nextStatus === ResidentMediaReviewStatus.REJECTED && reason
      ? String(reason).trim()
      : "";

  const saved = await ResidentMedia.findOneAndUpdate(
    {
      _id: media._id,
      $or: [
        { reviewStatus: ResidentMediaReviewStatus.PENDING },
        { reviewStatus: { $exists: false } },
      ],
    },
    {
      $set: {
        reviewStatus: nextStatus,
        reviewedBy: actor._id,
        reviewedAt: new Date(),
        reviewReason,
        visibleToFamily: nextStatus === ResidentMediaReviewStatus.APPROVED,
      },
    },
    { new: true }
  ).lean();

  if (!saved) throw new AppError("media_already_reviewed", 409);

  return {
    ...saved,
    blocked: false,
    resident: {
      _id: resident._id,
      name: resident.name,
      roomNumber: resident.roomNumber,
      photographyConsent: Boolean(resident.photographyConsent),
    },
  };
};

module.exports = {
  listResidentMedia,
  reviewResidentMedia,
};
