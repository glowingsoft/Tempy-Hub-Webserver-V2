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

/**
 * Name and photo of the user joined as `as`, with empty strings when missing. With a
 * `prefix` the fields are flat (fromName, fromPhotoUrl), for rows that carry two people.
 */
const personFields = (as = "user", prefix = "") => {
  const field = (name) =>
    prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
  return {
    [field("name")]: { $ifNull: [`$${as}.name`, ""] },
    [field("photoUrl")]: { $ifNull: [`$${as}.profileIcon`, ""] },
  };
};

const pickPerson = (row, prefix) => ({
  name: row[`${prefix}Name`],
  photoUrl: row[`${prefix}PhotoUrl`],
});

module.exports = {
  toObjectId,
  isValidObjectId,
  joinOne,
  personFields,
  pickPerson,
};
