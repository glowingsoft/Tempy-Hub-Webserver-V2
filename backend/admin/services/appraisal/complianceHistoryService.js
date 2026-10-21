const mongoose = require("mongoose");
const { SupervisionRecord } = require("@models/SupervisionRecord");
const { AppraisalRecord } = require("@models/AppraisalRecord");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { AppError } = require("@services/_errors/AppError");
const { ComplianceMeetingStatus } = require("@models/domainEnums");
const { generateMeta } = require("@utils/responseUtil");
const { facetCount } = require("@utils/paginate");
const {
  actorStanding,
  resolveScopedStaffIds,
  scopeBranchFilter,
} = require("../staff/staffAccess");
const { conductedByStages } = require("../staff/meetingConductor");

const TYPE_SUPERVISION = "supervision";
const TYPE_APPRAISAL = "appraisal";

const toObjectId = (value, key) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const parseType = (type) => {
  if (type == null || String(type).trim() === "") return null;
  const value = String(type).trim();
  if (value !== TYPE_SUPERVISION && value !== TYPE_APPRAISAL) {
    throw new AppError("invalid_compliance_history_type", 400);
  }
  return value;
};

const completedAtRange = (from, to) => {
  if (from == null && to == null) return null;
  const range = {};
  if (from != null && String(from).trim() !== "") {
    const start = new Date(from);
    if (Number.isNaN(start.getTime())) throw new AppError("invalid_date_range", 400);
    range.$gte = start;
  }
  if (to != null && String(to).trim() !== "") {
    const end = new Date(to);
    if (Number.isNaN(end.getTime())) throw new AppError("invalid_date_range", 400);
    range.$lte = end;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    throw new AppError("invalid_date_range", 400);
  }
  return Object.keys(range).length ? range : null;
};

const emptyPage = (page, limit) => ({
  data: [],
  meta: generateMeta(page, limit, 0),
});

const meetingMatch = ({ organizationId, staffIds, branchId, completedAt }) => {
  const match = {
    organizationId,
    status: ComplianceMeetingStatus.COMPLETED,
    staffId: { $in: staffIds },
  };
  if (branchId) match.branchId = branchId;
  if (completedAt) match.completedAt = completedAt;
  return match;
};

const shapeMeeting = (type) => ({
  $project: {
    type: { $literal: type },
    staffId: 1,
    branchId: 1,
    completedAt: 1,
    scheduledAt: 1,
    conductedByUserId: 1,
    conductedByStaffId: 1,
    actionPoints: 1,
    file: 1,
    status: 1,
  },
});

const staffLookup = {
  $lookup: {
    from: StaffProfile.collection.name,
    localField: "staffId",
    foreignField: "_id",
    pipeline: [
      {
        $lookup: {
          from: User.collection.name,
          localField: "userId",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                name: 1,
                email: 1,
                image: { $ifNull: ["$profileIcon", ""] },
              },
            },
            { $limit: 1 },
          ],
          as: "user",
        },
      },
      {
        $project: {
          employeeCode: 1,
          name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
          email: { $ifNull: [{ $arrayElemAt: ["$user.email", 0] }, ""] },
          image: { $ifNull: [{ $arrayElemAt: ["$user.image", 0] }, ""] },
        },
      },
      { $limit: 1 },
    ],
    as: "staff",
  },
};

const listComplianceHistory = async ({
  actor,
  organizationId,
  branchId,
  staffId,
  type,
  from,
  to,
  page,
  limit,
  skip,
}) => {
  const meetingType = parseType(type);
  const orgOid = toObjectId(organizationId, "invalid_organization_id");
  const standing = await actorStanding(actor, organizationId);
  const staffIds = await resolveScopedStaffIds({
    standing,
    actor,
    organizationId,
    staffId: staffId
      ? toObjectId(staffId, "invalid_staff_profile_id")
      : null,
    branchId,
  });
  if (!staffIds.length) return emptyPage(page, limit);

  const scopedBranch = scopeBranchFilter(standing, branchId);
  const match = meetingMatch({
    organizationId: orgOid,
    staffIds,
    branchId: scopedBranch
      ? toObjectId(String(scopedBranch), "invalid_branch_id")
      : null,
    completedAt: completedAtRange(from, to),
  });

  const includeSupervision =
    !meetingType || meetingType === TYPE_SUPERVISION;
  const includeAppraisal = !meetingType || meetingType === TYPE_APPRAISAL;

  const startModel = includeSupervision ? SupervisionRecord : AppraisalRecord;
  const startType = includeSupervision ? TYPE_SUPERVISION : TYPE_APPRAISAL;

  const pipeline = [{ $match: match }, shapeMeeting(startType)];

  if (includeSupervision && includeAppraisal) {
    pipeline.push({
      $unionWith: {
        coll: AppraisalRecord.collection.name,
        pipeline: [{ $match: match }, shapeMeeting(TYPE_APPRAISAL)],
      },
    });
  }

  pipeline.push({
    $facet: {
      data: [
        { $sort: { completedAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        ...conductedByStages,
        staffLookup,
        { $addFields: { staff: { $arrayElemAt: ["$staff", 0] } } },
      ],
      totalCount: [{ $count: "count" }],
    },
  });

  const [result] = await startModel.aggregate(pipeline);
  return {
    data: result?.data || [],
    meta: generateMeta(page, limit, facetCount(result?.totalCount)),
  };
};

module.exports = { listComplianceHistory };
