const mongoose = require("mongoose");
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

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

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

// Runs on the joined organization, so links in a home with the module off are dropped in the database.
const moduleActiveStage = (now) => ({
  $match: {
    "organization.moduleAccess": {
      $elemMatch: {
        moduleSlug: ModuleSlug.FAMILY_ENGAGEMENT,
        enabled: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
    },
  },
});

const activeLinkStages = (userId, now = new Date()) => [
  { $match: { userId: toObjectId(userId), status: FamilyMemberStatus.ACTIVE } },
  {
    $lookup: {
      from: Organization.collection.name,
      localField: "organizationId",
      foreignField: "_id",
      as: "organization",
    },
  },
  { $unwind: "$organization" },
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

/** activeResidentId is the resident the app is showing; if missing or not linked, the first is flagged. */
const resolveFamilyResidents = async (userId, { activeResidentId } = {}) => {
  const rows = await FamilyMember.aggregate([
    ...activeLinkStages(userId),
    {
      $lookup: {
        from: Resident.collection.name,
        localField: "residentId",
        foreignField: "_id",
        as: "resident",
      },
    },
    { $unwind: "$resident" },
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        as: "branch",
      },
    },
    { $unwind: { path: "$branch", preserveNullAndEmptyArrays: true } },
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

  const activeId = rows.some((r) => String(r.residentId) === String(activeResidentId))
    ? String(activeResidentId)
    : String(rows[0].residentId);

  return rows.map((row) => ({
    ...row,
    isActive: String(row.residentId) === activeId,
  }));
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
  isStaffAccount,
  listRelationships,
  isFamilyModuleActive,
  listActiveLinks,
  resolveFamilyResidents,
};
