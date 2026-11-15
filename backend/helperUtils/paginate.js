const { generateMeta } = require("./responseUtil");

const facetCount = (bucket) => bucket?.[0]?.count ?? 0;

/** Tab “All” total: same match as the other tabs, without the status/role filter. */
const allCountFacet = (countMatch) => ({
  allCount: [{ $match: countMatch }, { $count: "count" }],
});

const statusTabCountFacets = (countMatch, statuses, field = "status") => ({
  ...allCountFacet(countMatch),
  ...Object.fromEntries(
    statuses.map((status) => [
      `${status}Count`,
      [{ $match: { ...countMatch, [field]: status } }, { $count: "count" }],
    ])
  ),
});

const statusTabCountsFromFacet = (result, statuses) => ({
  all: facetCount(result?.allCount),
  ...Object.fromEntries(
    statuses.map((status) => [
      status,
      facetCount(result?.[`${status}Count`]),
    ])
  ),
});

const emptyStatusTabCounts = (statuses) => ({
  all: 0,
  ...Object.fromEntries(statuses.map((status) => [status, 0])),
});

/** Fill tab keys from a `$group` `_id` bucket; `all` must come from `allCount` `$count`. */
const countsFromGroupRows = (rows = [], keys, result) => {
  const counts = {
    all: facetCount(result?.allCount),
    ...Object.fromEntries(keys.map((key) => [key, 0])),
  };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row._id)) {
      counts[row._id] = row.count;
    }
  }
  return counts;
};

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

module.exports = {
  paginateWithFacet,
  keywordOr,
  facetCount,
  allCountFacet,
  statusTabCountFacets,
  statusTabCountsFromFacet,
  emptyStatusTabCounts,
  countsFromGroupRows,
};
