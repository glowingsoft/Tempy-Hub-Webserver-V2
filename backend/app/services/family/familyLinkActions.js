const mongoose = require("mongoose");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyHandover } = require("@models/FamilyHandover");
const { AppError } = require("@services/_errors/AppError");
const { notifyJoinDecided } = require("./familyJoinNotifications");
const { notifyAccessChanged } = require("./familyMemberNotifications");
const {
  FamilyHandoverStatus,
  FamilyMemberStatus,
} = require("@models/domainEnums");

const inTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
};

/** The status is part of the filter, so two people deciding at once cannot both win. */
const decidePendingRequest = async ({ linkId, decision, actorId }) => {
  const result = await FamilyMember.updateOne(
    { _id: linkId, status: FamilyMemberStatus.PENDING },
    { $set: { status: decision, decidedBy: actorId, decidedAt: new Date() } },
  );
  if (!result.modifiedCount)
    throw new AppError("join_request_not_pending", 409);
  await notifyJoinDecided({ linkId, decision, actorId });
};

const cancelHandoversOf = (link, session) =>
  FamilyHandover.updateMany(
    {
      residentId: link.residentId,
      status: FamilyHandoverStatus.PENDING,
      $or: [{ fromUserId: link.userId }, { toUserId: link.userId }],
    },
    { $set: { status: FamilyHandoverStatus.CANCELLED, decidedAt: new Date() } },
    { session },
  );

/** Pauses access without ending the link; any handover that involved them is cancelled. */
const deactivateActiveLink = async ({ link, actorId }) => {
  await inTransaction(async (session) => {
    const paused = await FamilyMember.updateOne(
      { _id: link._id, status: FamilyMemberStatus.ACTIVE, isNextOfKin: false },
      {
        $set: {
          status: FamilyMemberStatus.INACTIVE,
          inactiveBy: actorId,
          inactiveAt: new Date(),
        },
      },
      { session },
    );
    if (!paused.modifiedCount)
      throw new AppError("family_member_not_active", 409);

    await cancelHandoversOf(link, session);
  });
  await notifyAccessChanged({ linkId: link._id, change: "paused", actorId });
};

const reactivateLink = async ({ link }) => {
  const resumed = await FamilyMember.updateOne(
    { _id: link._id, status: FamilyMemberStatus.INACTIVE },
    {
      $set: {
        status: FamilyMemberStatus.ACTIVE,
        inactiveBy: null,
        inactiveAt: null,
      },
    },
  );
  if (!resumed.modifiedCount)
    throw new AppError("family_member_not_inactive", 409);
};

/** Removing someone also ends any handover that involved them, and clears the next-of-kin role. */
const removeActiveLink = async ({ link, actorId }) => {
  await inTransaction(async (session) => {
    const removed = await FamilyMember.updateOne(
      { _id: link._id, status: FamilyMemberStatus.ACTIVE },
      {
        $set: {
          status: FamilyMemberStatus.REMOVED,
          isNextOfKin: false,
          removedBy: actorId,
          removedAt: new Date(),
        },
      },
      { session },
    );
    if (!removed.modifiedCount)
      throw new AppError("family_member_not_found", 404);

    await cancelHandoversOf(link, session);
  });
  await notifyAccessChanged({ linkId: link._id, change: "removed", actorId });
};

/**
 * Makes `target` the next of kin. The old one steps down first (only one active next
 * of kin is allowed), and open handovers are settled: the one that led here is
 * accepted, any other is cancelled.
 */
const assignNextOfKin = async ({ target }) => {
  await inTransaction(async (session) => {
    await FamilyMember.updateMany(
      {
        residentId: target.residentId,
        status: FamilyMemberStatus.ACTIVE,
        isNextOfKin: true,
        _id: { $ne: target._id },
      },
      { $set: { isNextOfKin: false } },
      { session },
    );

    const promoted = await FamilyMember.updateOne(
      { _id: target._id, status: FamilyMemberStatus.ACTIVE },
      { $set: { isNextOfKin: true } },
      { session },
    );
    if (!promoted.modifiedCount)
      throw new AppError("family_member_not_found", 404);

    const decidedAt = new Date();
    await FamilyHandover.updateMany(
      {
        residentId: target.residentId,
        status: FamilyHandoverStatus.PENDING,
        $or: [{ homeChooses: true }, { toUserId: target.userId }],
      },
      { $set: { status: FamilyHandoverStatus.ACCEPTED, decidedAt } },
      { session },
    );
    await FamilyHandover.updateMany(
      { residentId: target.residentId, status: FamilyHandoverStatus.PENDING },
      { $set: { status: FamilyHandoverStatus.CANCELLED, decidedAt } },
      { session },
    );
  });
};

module.exports = {
  decidePendingRequest,
  removeActiveLink,
  deactivateActiveLink,
  reactivateLink,
  assignNextOfKin,
  inTransaction,
};
