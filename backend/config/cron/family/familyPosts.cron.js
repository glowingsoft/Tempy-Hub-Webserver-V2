const { publishDuePosts } = require("@adminServices/family/familyPostService");

/** Scheduled Community Wall posts that are due go live and their families are told. */
const runFamilyScheduledPostsCron = () => publishDuePosts();

module.exports = { runFamilyScheduledPostsCron };
