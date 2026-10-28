const mongoose = require("mongoose");
const { FamilySettings } = require("@models/FamilySettings");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteReminder } = require("@models/FamilyGazetteReminder");
const {
  AdmissionStatus,
  BranchStatus,
  OrganizationStatus,
} = require("@models/domainEnums");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const { getGazetteRules } = require("./familySettingsService");
const { choosePeriod, generateIssue } = require("./familyGazetteEngine");
const { renderInBackground } = require("./familyGazetteAdminService");
const {
  notifyClosingSoon,
  recipientsOf,
} = require("./familyGazetteNotifications");

const REMINDER_LEAD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const isDuplicateKey = (error) => error?.code === 11000;

const scheduledSites = async () => {
  const configured = await FamilySettings.aggregate([
    { $match: { "gazette.anchorDate": { $ne: null } } },
    { $project: { organizationId: 1 } },
  ]);
  const organizations = await Organization.aggregate([
    {
      $match: {
        _id: { $in: configured.map((row) => row.organizationId) },
        status: OrganizationStatus.ACTIVE,
      },
    },
    { $project: { moduleAccess: 1 } },
  ]);

  const sites = [];
  for (const organization of organizations.filter((entry) =>
    isFamilyModuleActive(entry),
  )) {
    const rules = await getGazetteRules({ organizationId: organization._id });
    const branches = await Branch.aggregate([
      {
        $match: {
          organizationId: organization._id,
          status: { $ne: BranchStatus.SUSPENDED },
        },
      },
      { $project: { name: 1, timezone: 1 } },
    ]);
    branches.forEach((branch) =>
      sites.push({
        organizationId: organization._id,
        branch,
        rules,
        timezone: branch.timezone || "Europe/London",
      }),
    );
  }
  return sites;
};

const generateDueIssues = async ({ now = new Date() } = {}) => {
  const result = { built: 0, skipped: 0, failed: 0 };

  for (const site of await scheduledSites()) {
    try {
      const period = choosePeriod({
        rules: site.rules,
        timezone: site.timezone,
        at: now,
        scheduled: true,
      });
      if (!period) {
        result.skipped += 1;
        continue;
      }
      const [existing] = await FamilyGazetteIssue.aggregate([
        { $match: { branchId: site.branch._id, periodStart: period.start } },
        { $project: { _id: 1 } },
      ]);
      const [residents] = await Resident.aggregate([
        {
          $match: {
            organizationId: site.organizationId,
            branchId: site.branch._id,
            admissionStatus: AdmissionStatus.ADMITTED,
          },
        },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ]);
      if (existing || !residents) {
        result.skipped += 1;
        continue;
      }

      const built = await generateIssue({
        organizationId: site.organizationId,
        branchId: site.branch._id,
        period,
        actor: null,
        now,
      });
      renderInBackground(built.issue._id);
      result.built += 1;
    } catch (error) {
      console.error("family gazette scheduled build failed", error.message);
      result.failed += 1;
    }
  }
  return result;
};

// The reminder row inserted first sends; if sending fails it is removed so the next run tries again.
const sendDueReminders = async ({ now = new Date() } = {}) => {
  const result = { sent: 0, skipped: 0, failed: 0 };

  for (const site of await scheduledSites()) {
    let claimed = null;
    try {
      const period = choosePeriod({
        rules: site.rules,
        timezone: site.timezone,
        at: now,
      });
      const untilClose = period.closesAt.getTime() - now.getTime();
      if (
        now < period.start ||
        untilClose <= 0 ||
        untilClose > REMINDER_LEAD_DAYS * DAY_MS
      ) {
        result.skipped += 1;
        continue;
      }

      // A site nobody is linked to yet is not claimed, so someone who joins before it closes is still reminded.
      const receivers = await recipientsOf({
        organizationId: site.organizationId,
        branchId: site.branch._id,
      });
      if (!receivers.length) {
        result.skipped += 1;
        continue;
      }

      try {
        claimed = await FamilyGazetteReminder.create({
          organizationId: site.organizationId,
          branchId: site.branch._id,
          periodStart: period.start,
          closesAt: period.closesAt,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        result.skipped += 1;
        continue;
      }

      await notifyClosingSoon({
        receivers,
        closesAt: period.closesAt,
        timezone: site.timezone,
        issueKey: claimed._id,
      });
      result.sent += 1;
    } catch (error) {
      console.error("family gazette reminder failed", error.message);
      result.failed += 1;
      if (claimed)
        await FamilyGazetteReminder.deleteOne({ _id: claimed._id }).catch(
          () => {},
        );
    }
  }
  return result;
};

module.exports = {
  generateDueIssues,
  sendDueReminders,
  scheduledSites,
  REMINDER_LEAD_DAYS,
};
