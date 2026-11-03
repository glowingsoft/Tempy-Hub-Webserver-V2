const { AppraisalRecord } = require("@models/AppraisalRecord");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { ComplianceMeetingStatus } = require("@models/domainEnums");
const { conductedByStages } = require("../staff/meetingConductor");

const MEETING_STATUSES = Object.values(ComplianceMeetingStatus);

const emptyStatusCounts = () =>
  Object.fromEntries(MEETING_STATUSES.map((status) => [status, 0]));

/** Tab totals ignore the current `status` filter. */
const countAppraisalStatuses = async (match) => {
  const counts = emptyStatusCounts();
  const rows = await AppraisalRecord.aggregate([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    if (counts[row._id] != null) counts[row._id] = row.count;
  }
  return counts;
};

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
          branchId: 1,
          startDate: 1,
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

const branchLookup = {
  $lookup: {
    from: Branch.collection.name,
    localField: "branchId",
    foreignField: "_id",
    pipeline: [{ $project: { name: 1, code: 1, timezone: 1 } }, { $limit: 1 }],
    as: "branch",
  },
};

const signedOffLookup = {
  $lookup: {
    from: User.collection.name,
    localField: "actionPoints.signedOffByUserId",
    foreignField: "_id",
    pipeline: [
      {
        $project: {
          name: 1,
          email: 1,
          image: { $ifNull: ["$profileIcon", ""] },
        },
      },
    ],
    as: "signedOffUsers",
  },
};

const staffSignedLookup = {
  $lookup: {
    from: User.collection.name,
    localField: "staffSignedByUserId",
    foreignField: "_id",
    pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
    as: "staffSigner",
  },
};

const managerSignedLookup = {
  $lookup: {
    from: User.collection.name,
    localField: "siteManagerSignedByUserId",
    foreignField: "_id",
    pipeline: [{ $project: { name: 1 } }, { $limit: 1 }],
    as: "managerSigner",
  },
};

const shapeFields = {
  $addFields: {
    staff: { $arrayElemAt: ["$staff", 0] },
    branch: { $arrayElemAt: ["$branch", 0] },
    staffSignedBy: { $ifNull: [{ $arrayElemAt: ["$staffSigner.name", 0] }, ""] },
    siteManagerSignedBy: {
      $ifNull: [{ $arrayElemAt: ["$managerSigner.name", 0] }, ""],
    },
    actionPoints: {
      $map: {
        input: { $ifNull: ["$actionPoints", []] },
        as: "point",
        in: {
          $mergeObjects: [
            "$$point",
            {
              signedOffByUser: {
                $let: {
                  vars: {
                    signer: {
                      $first: {
                        $filter: {
                          input: "$signedOffUsers",
                          as: "row",
                          cond: { $eq: ["$$row._id", "$$point.signedOffByUserId"] },
                        },
                      },
                    },
                  },
                  in: { $ifNull: ["$$signer", null] },
                },
              },
              signedOffBy: {
                $let: {
                  vars: {
                    signer: {
                      $first: {
                        $filter: {
                          input: "$signedOffUsers",
                          as: "row",
                          cond: { $eq: ["$$row._id", "$$point.signedOffByUserId"] },
                        },
                      },
                    },
                  },
                  in: { $ifNull: ["$$signer.name", ""] },
                },
              },
            },
          ],
        },
      },
    },
  },
};

/** Shared lookups for list (after skip/limit) and get-by-id. */
const appraisalRecordStages = [
  ...conductedByStages,
  staffLookup,
  branchLookup,
  signedOffLookup,
  staffSignedLookup,
  managerSignedLookup,
  shapeFields,
  { $project: { signedOffUsers: 0, staffSigner: 0, managerSigner: 0 } },
];

module.exports = {
  MEETING_STATUSES,
  emptyStatusCounts,
  countAppraisalStatuses,
  appraisalRecordStages,
};
