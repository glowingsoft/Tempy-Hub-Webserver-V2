const mongoose = require("mongoose");
const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyHandover } = require("@models/FamilyHandover");
const { AppError } = require("@services/_errors/AppError");
const { FamilyHandoverStatus, FamilyMemberStatus } = require("@models/domainEnums");
const { listActiveLinks } = require("./familyAccessService");
const {
  toObjectId,
  isValidObjectId,
  joinOne,
  personFields,
  pickPerson,
} = require("./familyPipeline");

const shapeHandover = (handover) => ({
  handoverId: handover._id,
  residentId: handover.residentId,
  status: handover.status,
  homeChooses: handover.homeChooses,
  requestedAt: handover.requestedAt,
});

/** Active members can be chosen; people still waiting for approval are shown but not selectable. */
const listCandidates = async ({ userId, link }) => {
  const members = await FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(link.residentId),
        userId: { $ne: toObjectId(userId) },
        status: { $in: [FamilyMemberStatus.ACTIVE, FamilyMemberStatus.PENDING] },
      },
    },
    ...joinOne({ from: User, localField: "userId", as: "user" }),
    { $sort: { status: 1, createdAt: 1 } },
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        ...personFields(),
        relationship: 1,
        status: 1,
      },
    },
  ]);

  return {
    residentId: link.residentId,
    canLetHomeChoose: true,
    members: members.map((member) => ({
      ...member,
      canSelect: member.status === FamilyMemberStatus.ACTIVE,
    })),
  };
};

const findHandoverTarget = async ({ userId, link, toMemberId }) => {
  if (!isValidObjectId(toMemberId)) throw new AppError("family_member_not_found", 404);

  const [target] = await FamilyMember.aggregate([
    { $match: { _id: toObjectId(toMemberId), residentId: toObjectId(link.residentId) } },
    { $project: { userId: 1, status: 1 } },
  ]);
  if (!target) throw new AppError("family_member_not_found", 404);
  if (String(target.userId) === String(userId)) throw new AppError("handover_to_self", 400);
  if (target.status === FamilyMemberStatus.PENDING) {
    throw new AppError("handover_member_not_approved", 409);
  }
  if (target.status !== FamilyMemberStatus.ACTIVE) {
    throw new AppError("family_member_not_found", 404);
  }
  return target;
};

const assertNoOpenHandover = async (residentId) => {
  const [open] = await FamilyHandover.aggregate([
    { $match: { residentId: toObjectId(residentId), status: FamilyHandoverStatus.PENDING } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  if (open) throw new AppError("handover_pending", 409);
};

/** Ask one member to take over, or ask the home to choose. The next of kin keeps the role until it is accepted. */
const requestHandover = async ({ userId, link, toMemberId, homeChooses }) => {
  if (Boolean(toMemberId) === Boolean(homeChooses)) {
    throw new AppError("handover_target_required", 400);
  }

  const target = homeChooses ? null : await findHandoverTarget({ userId, link, toMemberId });
  await assertNoOpenHandover(link.residentId);

  try {
    const handover = await FamilyHandover.create({
      organizationId: link.organizationId,
      branchId: link.branchId,
      residentId: link.residentId,
      fromUserId: userId,
      toUserId: target ? target.userId : null,
      homeChooses: Boolean(homeChooses),
    });
    return shapeHandover(handover);
  } catch (error) {
    // two requests at the same moment: the one-open-handover index caught the second
    if (error.code === 11000) throw new AppError("handover_pending", 409);
    throw error;
  }
};

/** The open handover the caller is part of, as the one asking or the one asked. */
const getCurrentHandover = async ({ userId, residentId }) => {
  const links = await listActiveLinks(userId);
  const residentIds = links
    .map((link) => link.residentId)
    .filter((id) => !residentId || String(id) === String(residentId))
    .map(toObjectId);
  if (!residentIds.length) return null;

  const me = toObjectId(userId);
  const [row] = await FamilyHandover.aggregate([
    {
      $match: {
        residentId: { $in: residentIds },
        status: FamilyHandoverStatus.PENDING,
        $or: [{ fromUserId: me }, { toUserId: me }],
      },
    },
    { $sort: { requestedAt: -1 } },
    { $limit: 1 },
    ...joinOne({ from: Resident, localField: "residentId", as: "resident" }),
    ...joinOne({ from: User, localField: "fromUserId", as: "from" }),
    ...joinOne({ from: User, localField: "toUserId", as: "to", optional: true }),
    {
      $project: {
        residentId: 1,
        status: 1,
        homeChooses: 1,
        requestedAt: 1,
        fromUserId: 1,
        residentName: { $ifNull: ["$resident.name", ""] },
        ...personFields("from", "from"),
        ...personFields("to", "to"),
      },
    },
  ]);
  if (!row) return null;

  return {
    ...shapeHandover(row),
    residentName: row.residentName,
    direction: String(row.fromUserId) === String(userId) ? "outgoing" : "incoming",
    from: pickPerson(row, "from"),
    to: row.homeChooses ? null : pickPerson(row, "to"),
  };
};

/** side: "toUserId" for the person asked, "fromUserId" for the next of kin who asked. */
const loadOpenHandover = async ({ userId, handoverId, side }) => {
  if (!isValidObjectId(handoverId)) throw new AppError("handover_not_found", 404);

  const [row] = await FamilyHandover.aggregate([
    { $match: { _id: toObjectId(handoverId), [side]: toObjectId(userId) } },
    { $project: { organizationId: 1, residentId: 1, fromUserId: 1, toUserId: 1, status: 1 } },
  ]);
  if (!row) throw new AppError("handover_not_found", 404);

  const links = await listActiveLinks(userId);
  if (!links.some((link) => String(link.residentId) === String(row.residentId))) {
    throw new AppError("handover_not_found", 404);
  }
  if (row.status !== FamilyHandoverStatus.PENDING) {
    throw new AppError("handover_not_pending", 409);
  }
  return row;
};

const closeHandover = async ({ userId, handoverId, side, status }) => {
  const row = await loadOpenHandover({ userId, handoverId, side });

  const result = await FamilyHandover.updateOne(
    { _id: row._id, status: FamilyHandoverStatus.PENDING },
    { $set: { status, decidedAt: new Date() } }
  );
  if (!result.modifiedCount) throw new AppError("handover_not_pending", 409);

  return { handoverId: row._id, status };
};

const declineHandover = ({ userId, handoverId }) =>
  closeHandover({ userId, handoverId, side: "toUserId", status: FamilyHandoverStatus.DECLINED });

const cancelHandover = ({ userId, handoverId }) =>
  closeHandover({ userId, handoverId, side: "fromUserId", status: FamilyHandoverStatus.CANCELLED });

const STALE = Symbol("handover no longer valid");

/** The next of kin steps down and the person asked steps up, together or not at all. */
const swapNextOfKin = async (row, session) => {
  const { residentId, fromUserId, toUserId } = row;

  // the old one steps down first: only one active next of kin is allowed at a time
  const demoted = await FamilyMember.updateOne(
    { residentId, userId: fromUserId, status: FamilyMemberStatus.ACTIVE, isNextOfKin: true },
    { $set: { isNextOfKin: false } },
    { session }
  );
  const promoted = demoted.modifiedCount
    ? await FamilyMember.updateOne(
        { residentId, userId: toUserId, status: FamilyMemberStatus.ACTIVE },
        { $set: { isNextOfKin: true } },
        { session }
      )
    : null;
  if (!promoted?.modifiedCount) throw STALE;

  const closed = await FamilyHandover.updateOne(
    { _id: row._id, status: FamilyHandoverStatus.PENDING },
    { $set: { status: FamilyHandoverStatus.ACCEPTED, decidedAt: new Date() } },
    { session }
  );
  if (!closed.modifiedCount) throw new AppError("handover_not_pending", 409);
};

const acceptHandover = async ({ userId, handoverId }) => {
  const row = await loadOpenHandover({ userId, handoverId, side: "toUserId" });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => swapNextOfKin(row, session));
  } catch (error) {
    if (error !== STALE) throw error;

    // the next of kin changed, or one of the two left, since it was asked
    await FamilyHandover.updateOne(
      { _id: row._id, status: FamilyHandoverStatus.PENDING },
      { $set: { status: FamilyHandoverStatus.CANCELLED, decidedAt: new Date() } }
    );
    throw new AppError("handover_no_longer_valid", 409);
  } finally {
    await session.endSession();
  }

  return { handoverId: row._id, status: FamilyHandoverStatus.ACCEPTED, residentId: row.residentId };
};

/** The next of kin can't leave until someone has taken over. Leaving also withdraws any handover asked of them. */
const leaveFamily = async ({ userId, link }) => {
  if (link.isNextOfKin) throw new AppError("next_of_kin_must_hand_over", 409);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await FamilyMember.updateOne(
        { residentId: link.residentId, userId, status: FamilyMemberStatus.ACTIVE },
        {
          $set: {
            status: FamilyMemberStatus.REMOVED,
            removedBy: userId,
            removedAt: new Date(),
          },
        },
        { session }
      );
      await FamilyHandover.updateMany(
        { residentId: link.residentId, toUserId: userId, status: FamilyHandoverStatus.PENDING },
        { $set: { status: FamilyHandoverStatus.CANCELLED, decidedAt: new Date() } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  return { residentId: link.residentId, status: FamilyMemberStatus.REMOVED };
};

module.exports = {
  listCandidates,
  requestHandover,
  getCurrentHandover,
  acceptHandover,
  declineHandover,
  cancelHandover,
  leaveFamily,
};
