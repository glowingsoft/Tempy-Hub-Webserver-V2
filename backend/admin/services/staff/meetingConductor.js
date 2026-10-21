const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");

const actorConductor = async ({ actor, organizationId }) => {
  const profile = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
  })
    .select("_id")
    .lean();

  return {
    conductedByUserId: actor._id,
    conductedByStaffId: profile?._id || null,
  };
};

const conductedByStages = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "conductedByUserId",
      foreignField: "_id",
      pipeline: [{ $project: { name: 1 } }],
      as: "conductorUser",
    },
  },
  {
    $lookup: {
      from: StaffProfile.collection.name,
      localField: "conductedByStaffId",
      foreignField: "_id",
      pipeline: [
        {
          $lookup: {
            from: User.collection.name,
            localField: "userId",
            foreignField: "_id",
            pipeline: [{ $project: { name: 1 } }],
            as: "user",
          },
        },
        {
          $project: {
            name: { $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, ""] },
          },
        },
      ],
      as: "conductorStaff",
    },
  },
  {
    $addFields: {
      conductedBy: {
        $ifNull: [
          { $arrayElemAt: ["$conductorUser.name", 0] },
          { $ifNull: [{ $arrayElemAt: ["$conductorStaff.name", 0] }, ""] },
        ],
      },
    },
  },
  { $project: { conductorUser: 0, conductorStaff: 0 } },
];

module.exports = { actorConductor, conductedByStages };
