const { publishDuePosts } = require("@adminServices/family/familyPostService");
const { sendDueNewsletters } = require("@adminServices/family/familyNewsletterService");

/** Scheduled Community Wall posts that are due go live and their families are told. */
const runFamilyScheduledPostsCron = () => publishDuePosts();

/** Scheduled newsletters that are due are sent. */
const runFamilyScheduledNewslettersCron = () => sendDueNewsletters();

module.exports = { runFamilyScheduledPostsCron, runFamilyScheduledNewslettersCron };
