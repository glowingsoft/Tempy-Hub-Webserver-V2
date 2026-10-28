const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { AdmissionStatus, BranchStatus, FamilyMemberStatus, FamilyUploadStatus } = require("@models/domainEnums");
const { toObjectId } = require("@appServices/family/familyPipeline");
const { getGazetteRules } = require("./familySettingsService");
const { currentPeriod } = require("./familyGazettePeriod");
const { periodLabel } = require("./familyGazettePdf");

const DAY_MS = 24 * 60 * 60 * 1000;

const sitesOf = async ({ organizationId, branchId }) => {
  const match = { organizationId: toObjectId(organizationId), status: { $ne: BranchStatus.SUSPENDED } };
  if (branchId) match._id = toObjectId(branchId);
  return Branch.aggregate([{ $match: match }, { $project: { timezone: 1 } }]);
};

// Worked out live from what is approved. A resident counts as with content (a family and a message), no content (a family, no message), no family, or over the cap.
const cardOfSite = async ({ organizationId, site, rules, now }) => {
  const timezone = site.timezone || "Europe/London";
  const period = currentPeriod({ anchorDate: rules.anchorDate, issueEveryDays: rules.issueEveryDays, timezone, at: now });

  const [built] = await FamilyGazetteIssue.aggregate([{ $match: { branchId: site._id, periodStart: period.start } }]);
  const [latest] = await FamilyGazetteIssue.aggregate([{ $match: { branchId: site._id } }, { $group: { _id: null, number: { $max: "$number" } } }]);
  const cap = built?.messageCap ?? rules.messageCap;

  const residents = await Resident.aggregate([
    { $match: { organizationId: toObjectId(organizationId), branchId: site._id, admissionStatus: AdmissionStatus.ADMITTED } },
    { $project: { _id: 1 } },
  ]);
  const residentIds = residents.map((resident) => resident._id);

  const [families, uploads, earlier] = await Promise.all([
    FamilyMember.aggregate([
      { $match: { organizationId: toObjectId(organizationId), branchId: site._id, residentId: { $in: residentIds }, status: FamilyMemberStatus.ACTIVE } },
      { $group: { _id: "$residentId" } },
    ]),
    FamilyUpload.aggregate([
      {
        $match: {
          organizationId: toObjectId(organizationId),
          branchId: site._id,
          residentId: { $in: residentIds },
          status: FamilyUploadStatus.APPROVED,
          includeInGazette: true,
          createdAt: { $lte: period.end },
        },
      },
      { $project: { residentId: 1 } },
    ]),
    FamilyGazetteItem.aggregate([
      { $match: { residentId: { $in: residentIds }, ...(built ? { issueId: { $ne: built._id } } : {}) } },
      { $project: { uploadIds: 1, removedUploadIds: 1 } },
    ]),
  ]);

  const used = new Set(earlier.flatMap((item) => [...item.uploadIds, ...item.removedUploadIds]).map(String));
  const withFamily = new Set(families.map((row) => String(row._id)));
  const messages = new Map();
  uploads.filter((upload) => !used.has(String(upload._id))).forEach((upload) => {
    const id = String(upload.residentId);
    messages.set(id, (messages.get(id) ?? 0) + 1);
  });

  const counts = { total: residentIds.length, withContent: 0, noContent: 0, noFamily: 0, overCap: 0 };
  residentIds.forEach((residentId) => {
    const id = String(residentId);
    const sent = messages.get(id) ?? 0;
    if (!withFamily.has(id)) counts.noFamily += 1;
    else if (sent > 0) counts.withContent += 1;
    else counts.noContent += 1;
    if (withFamily.has(id) && sent > cap) counts.overCap += 1;
  });

  const untilClose = Math.max(0, period.closesAt.getTime() - now.getTime());
  return {
    number: built?.number ?? (latest?.number ?? 0) + 1,
    state: now >= period.start ? "collecting" : "notStarted",
    periodLabel: periodLabel({ periodStart: period.start, periodEnd: period.end, timezone }),
    closesAt: period.closesAt,
    closesInDays: Math.ceil(untilClose / DAY_MS),
    messageCap: cap,
    residents: counts,
  };
};

// With no site chosen the card covers every active site: counts add up, and the earliest close is shown.
const getWallGazetteCard = async ({ organizationId, branchId, now = new Date() }) => {
  const rules = await getGazetteRules({ organizationId });
  if (!rules.configured) return { scheduled: false };

  const sites = await sitesOf({ organizationId, branchId });
  if (!sites.length) return null;

  const cards = await Promise.all(sites.map((site) => cardOfSite({ organizationId, site, rules, now })));
  const residents = { total: 0, withContent: 0, noContent: 0, noFamily: 0, overCap: 0 };
  cards.forEach((card) => Object.keys(residents).forEach((key) => { residents[key] += card.residents[key]; }));
  const soonest = cards.reduce((first, card) => (card.closesAt < first.closesAt ? card : first));

  return {
    scheduled: true,
    sites: cards.length,
    number: Math.max(...cards.map((card) => card.number)),
    state: soonest.state,
    periodLabel: soonest.periodLabel,
    closesAt: soonest.closesAt,
    closesInDays: soonest.closesInDays,
    messageCap: soonest.messageCap,
    residents,
    percentWithContent: residents.total ? Math.round((residents.withContent / residents.total) * 100) : 0,
  };
};

module.exports = { getWallGazetteCard };
