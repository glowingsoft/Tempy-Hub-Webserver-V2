const mongoose = require("mongoose");

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * $lookup + $unwind to attach one document by _id. With `optional`, a row whose
 * match is missing is kept instead of dropped.
 */
const joinOne = ({ from, localField, as, optional = false }) => [
  {
    $lookup: {
      from: from.collection.name,
      localField,
      foreignField: "_id",
      as,
    },
  },
  {
    $unwind: optional
      ? { path: `$${as}`, preserveNullAndEmptyArrays: true }
      : `$${as}`,
  },
];

/** Name and photo of the user joined as `as`, with empty strings when missing. */
const personFields = (as = "user") => ({
  name: { $ifNull: [`$${as}.name`, ""] },
  photoUrl: { $ifNull: [`$${as}.profileIcon`, ""] },
});

module.exports = { toObjectId, isValidObjectId, joinOne, personFields };
