const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { Membership } = require("@models/Membership");
const {
  FamilyMemberStatus,
  FamilyRelationship,
  ModuleSlug,
} = require("@models/domainEnums");
const { toObjectId, joinOne } = require("./familyPipeline");

const RELATIONSHIP_LABELS = {
  [FamilyRelationship.SPOUSE]: "Spouse",
  [FamilyRelationship.PARTNER]: "Partner",
  [FamilyRelationship.SON]: "Son",
  [FamilyRelationship.DAUGHTER]: "Daughter",
  [FamilyRelationship.GRANDSON]: "Grandson",
  [FamilyRelationship.GRANDDAUGHTER]: "Granddaughter",
  [FamilyRelationship.BROTHER]: "Brother",
  [FamilyRelationship.SISTER]: "Sister",
  [FamilyRelationship.NEPHEW]: "Nephew",
  [FamilyRelationship.NIECE]: "Niece",
  [FamilyRelationship.FRIEND]: "Friend",
  [FamilyRelationship.LEGAL_GUARDIAN]: "Legal guardian",
  [FamilyRelationship.OTHER]: "Other",
};

const listRelationships = () =>
  Object.values(FamilyRelationship).map((value) => ({
    value,
    label: RELATIONSHIP_LABELS[value] || value,
  }));

const isFamilyModuleActive = (organization, now = new Date()) => {
  const entry = (organization?.moduleAccess || []).find(
    (m) => m.moduleSlug === ModuleSlug.FAMILY_ENGAGEMENT
  );
  return Boolean(
    entry && entry.enabled && (!entry.expiresAt || new Date(entry.expiresAt) > now)
  );
};

// `path` is where the module list sits: on a joined organization, so links in a home
// with the module off are dropped in the database, or on the organization itself.
const moduleActiveStage = (now, path = "organization.moduleAccess") => ({
  $match: {
    [path]: {
      $elemMatch: {
        moduleSlug: ModuleSlug.FAMILY_ENGAGEMENT,
        enabled: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
    },
  },
});

/** Which of these organizations currently have Family Engagement on. */
const familyModuleOrganizationIds = async (organizationIds) => {
  if (!organizationIds.length) return [];

  const rows = await Organization.aggregate([
    { $match: { _id: { $in: organizationIds.map(toObjectId) } } },
    moduleActiveStage(new Date(), "moduleAccess"),
    { $project: { _id: 1 } },
  ]);
  return rows.map((row) => row._id);
};

const activeLinkStages = (userId, now = new Date()) => [
  { $match: { userId: toObjectId(userId), status: FamilyMemberStatus.ACTIVE } },
  ...joinOne({ from: Organization, localField: "organizationId", as: "organization" }),
  moduleActiveStage(now),
  { $sort: { createdAt: 1 } },
];

/** Read live on every request; links in a home with Family Engagement off are left out. */
const listActiveLinks = (userId) =>
  FamilyMember.aggregate([
    ...activeLinkStages(userId),
    {
      $project: {
        _id: 0,
        organizationId: 1,
        branchId: 1,
        residentId: 1,
        relationship: 1,
        isNextOfKin: 1,
        organizationName: "$organization.name",
      },
    },
  ]);

const pickActiveResidentId = (rows, requestedId) =>
  rows.some((row) => String(row.residentId) === String(requestedId))
    ? String(requestedId)
    : String(rows[0].residentId);

/** activeResidentId is the resident the app is showing; if missing or not linked, the first is flagged. */
const resolveFamilyResidents = async (userId, { activeResidentId } = {}) => {
  const rows = await FamilyMember.aggregate([
    ...activeLinkStages(userId),
    ...joinOne({ from: Resident, localField: "residentId", as: "resident" }),
    ...joinOne({ from: Branch, localField: "branchId", as: "branch", optional: true }),
    {
      $project: {
        _id: 0,
        residentId: 1,
        residentName: { $ifNull: ["$resident.name", ""] },
        residentPhotoUrl: { $ifNull: ["$resident.photoUrl", ""] },
        roomNumber: { $ifNull: ["$resident.roomNumber", ""] },
        homeName: { $ifNull: ["$branch.name", "$organization.name"] },
        organizationId: 1,
        branchId: 1,
        relationship: 1,
        isNextOfKin: 1,
      },
    },
  ]);
  if (!rows.length) return [];

  const activeId = pickActiveResidentId(rows, activeResidentId);
  return rows.map((row) => ({ ...row, isActive: String(row.residentId) === activeId }));
};

/**
 * Why a member sees no residents: "active" (has links), "pending" (waiting for approval),
 * "inactive" (staff paused their access), "removed" (every link ended by removal, so the app shows You no longer have access) or "none".
 */
const resolveAccessState = async (userId, residentCount) => {
  if (residentCount > 0) return "active";

  const rows = await FamilyMember.aggregate([
    { $match: { userId: toObjectId(userId) } },
    { $group: { _id: "$status" } },
  ]);
  const statuses = rows.map((row) => row._id);
  if (statuses.includes(FamilyMemberStatus.PENDING)) return "pending";
  if (statuses.includes(FamilyMemberStatus.INACTIVE)) return "inactive";
  if (statuses.includes(FamilyMemberStatus.REMOVED)) return "removed";
  return "none";
};

/** One email holds one role: any staff membership, or a platform admin, makes it a staff account. */
const isStaffAccount = async (user) => {
  if (user?.accountState?.userType === "admin") return true;

  const [membership] = await Membership.aggregate([
    { $match: { userId: toObjectId(user._id) } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  return Boolean(membership);
};

module.exports = {
  listRelationships,
  isFamilyModuleActive,
  moduleActiveStage,
  familyModuleOrganizationIds,
  listActiveLinks,
  resolveFamilyResidents,
  resolveAccessState,
  isStaffAccount,
};
