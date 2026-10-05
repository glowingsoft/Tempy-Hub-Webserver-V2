const { generateMeta } = require("./responseUtil");

const facetCount = (bucket) => bucket?.[0]?.count ?? 0;

const keywordOr = (keyword, fields, { trim = false } = {}) => {
  if (keyword == null) return null;
  if (trim && String(keyword).trim() === "") return null;
  if (!trim && !keyword) return null;
  return fields.map((field) => ({
    [field]: { $regex: keyword, $options: "i" },
  }));
};

/**
 * One round-trip list: filtered data + total, plus optional extra $facet branches.
 * When applyLimit is false, skip/limit are omitted (same as mongoose .limit(0)).
 */
const paginateWithFacet = async ({
  model,
  match,
  page,
  limit,
  skip,
  sort = { createdAt: -1 },
  applyLimit = true,
  extraDataStages = [],
  extraFacets = {},
}) => {
  const sortAndPage = [{ $sort: sort }];
  if (applyLimit) {
    sortAndPage.push({ $skip: skip }, { $limit: limit });
  }
  sortAndPage.push(...extraDataStages);

  const hasExtraFacets = Object.keys(extraFacets).length > 0;
  const pipeline = hasExtraFacets
    ? [
        {
          $facet: {
            data: [{ $match: match }, ...sortAndPage],
            totalCount: [{ $match: match }, { $count: "count" }],
            ...extraFacets,
          },
        },
      ]
    : [
        { $match: match },
        {
          $facet: {
            data: sortAndPage,
            totalCount: [{ $count: "count" }],
          },
        },
      ];

  const [result] = await model.aggregate(pipeline);

  const totalRecords = facetCount(result.totalCount);
  return {
    result,
    data: result.data,
    meta: generateMeta(page, limit, totalRecords),
  };
};

module.exports = { paginateWithFacet, keywordOr, facetCount };
