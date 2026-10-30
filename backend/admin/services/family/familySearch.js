const { User } = require("@models/UserModel");
const { Resident } = require("@models/Resident");
const { searchText } = require("@utils/familyQuery");
const { toObjectId } = require("@appServices/family/familyPipeline");

const MAX_MATCHES = 500;
const MAX_POOL = 5000;

const regexOn = (text) => ({ $regex: text, $options: "i" });

/** Residents of the organization (and site) whose name or room matches the text. */
const residentIdsMatching = async ({ organizationId, branchId, text }) => {
  const match = {
    organizationId: toObjectId(organizationId),
    $or: [{ name: regexOn(text) }, { roomNumber: regexOn(text) }],
  };
  if (branchId) match.branchId = toObjectId(branchId);

  const rows = await Resident.aggregate([
    { $match: match },
    { $limit: MAX_MATCHES },
    { $project: { _id: 1 } },
  ]);
  return rows.map((row) => row._id);
};

/** People named in a collection (authors, members) whose name or email matches the text. */
const userIdsMatching = async ({
  model,
  field,
  organizationId,
  branchId,
  text,
}) => {
  const scope = { organizationId: toObjectId(organizationId) };
  if (branchId) scope.branchId = toObjectId(branchId);

  const rows = await model.aggregate([
    { $match: scope },
    { $group: { _id: `$${field}` } },
    { $limit: MAX_POOL },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $match: {
        $or: [{ "user.name": regexOn(text) }, { "user.email": regexOn(text) }],
      },
    },
    { $limit: MAX_MATCHES },
    { $project: { _id: 1 } },
  ]);
  return rows.map((row) => row._id);
};

/**
 * A search box over a list: `fields` are on the document itself, `resident` and `person` point
 * at the fields holding a resident id (or an array of them) or a user id. The text is taken
 * literally. Returns the $or to add to the list's filter, or null when nothing was typed;
 * a search that finds nothing returns an $or that matches nothing.
 */
const searchClause = async ({
  keyword,
  organizationId,
  branchId,
  fields = [],
  resident,
  person,
}) => {
  const text = searchText(keyword);
  if (!text || !text.trim()) return null;

  const clauses = fields.map((field) => ({ [field]: regexOn(text) }));

  if (resident) {
    const ids = await residentIdsMatching({ organizationId, branchId, text });
    if (ids.length) clauses.push({ [resident]: { $in: ids } });
  }
  if (person) {
    const ids = await userIdsMatching({
      ...person,
      organizationId,
      branchId,
      text,
    });
    if (ids.length) clauses.push({ [person.path]: { $in: ids } });
  }

  return clauses.length ? clauses : [{ _id: { $in: [] } }];
};

module.exports = { searchClause };
