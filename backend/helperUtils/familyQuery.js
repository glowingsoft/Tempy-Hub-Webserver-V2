const { AppError } = require("@services/_errors/AppError");

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const MAX_SEARCH_LENGTH = 100;

/**
 * Express parses ?status[$ne]=x into an object. Anything that is not a plain string is
 * dropped here, so a caller can never smuggle a query operator into a filter.
 */
const queryText = (value) => (typeof value === "string" ? value : undefined);

/** A filter id: absent is fine, anything present must be a 24-character hex id. The error names the field. */
const queryId = (value, field = "id") => {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !OBJECT_ID.test(value)) throw new AppError("invalid_filter_id", 400, { field });
  return value;
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Search text taken literally (no regex of the caller's choosing) and kept short. */
const searchText = (value) => {
  const text = queryText(value);
  return text === undefined ? undefined : escapeRegex(text.slice(0, MAX_SEARCH_LENGTH));
};

module.exports = { queryText, queryId, searchText };
