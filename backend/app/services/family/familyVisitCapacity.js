const { FamilyVisit } = require("@models/FamilyVisit");
const {
  FamilyVisitStatus,
  FamilyVisitSource,
} = require("@models/domainEnums");
const { toObjectId } = require("./familyPipeline");

/** A waiting request holds its seats as well, so two families cannot be promised the same ones. */
const HOLDING = [FamilyVisitStatus.REQUESTED, FamilyVisitStatus.CONFIRMED];

const holdingMatch = (branchId) => ({
  branchId: toObjectId(branchId),
  source: FamilyVisitSource.FAMILY,
  status: { $in: HOLDING },
});

/** People already holding a place at one time. */
const seatsHeld = async ({ branchId, place, startAt }) => {
  const [row] = await FamilyVisit.aggregate([
    { $match: { ...holdingMatch(branchId), place, startAt } },
    { $group: { _id: null, people: { $sum: "$partySize" } } },
  ]);
  return row?.people ?? 0;
};

/** People holding each place and start time in a range, for the capacity card. */
const seatsInRange = async ({ branchId, from, to }) => {
  const rows = await FamilyVisit.aggregate([
    { $match: { ...holdingMatch(branchId), startAt: { $gte: from, $lt: to } } },
    {
      $group: {
        _id: { place: "$place", startAt: "$startAt" },
        people: { $sum: "$partySize" },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      `${row._id.place}|${new Date(row._id.startAt).getTime()}`,
      row.people,
    ]),
  );
};

module.exports = { seatsHeld, seatsInRange };
