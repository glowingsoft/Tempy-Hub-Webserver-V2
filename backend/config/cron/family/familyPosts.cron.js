const { publishDuePosts } = require("@adminServices/family/familyPostService");
const { sendDueNewsletters, recoverStuckNewsletters } = require("@adminServices/family/familyNewsletterService");

/** Scheduled Community Wall posts that are due go live and their families are told. */
const runFamilyScheduledPostsCron = () => publishDuePosts();

/** Scheduled newsletters that are due are sent, and any that stopped part-way through a send are finished. */
const runFamilyScheduledNewslettersCron = async () => {
  await sendDueNewsletters();
  await recoverStuckNewsletters();
};

module.exports = { runFamilyScheduledPostsCron, runFamilyScheduledNewslettersCron };
