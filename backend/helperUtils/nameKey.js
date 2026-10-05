/**
 * Normalised form of a display name, used by unique-name indexes.
 *
 * Uniqueness has to ignore the differences a human would not notice, so
 * "Oakfield Care Home", "oakfield care home", and "Oakfield  Care Home" all
 * collapse to one key and cannot coexist.
 */
const nameKeyOf = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

module.exports = { nameKeyOf };
