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

/** Labels for the Relationship dropdowns, in the order the app shows them. */
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

/** True when the organization currently has Family Engagement switched on. */
const isFamilyModuleActive = (organization, now = new Date()) => {
  const entry = (organization?.moduleAccess || []).find(
    (m) => m.moduleSlug === ModuleSlug.FAMILY_ENGAGEMENT
  );
  return Boolean(
    entry && entry.enabled && (!entry.expiresAt || new Date(entry.expiresAt) > now)
  );
};

/**
 * Matches organizations that currently have Family Engagement switched on. Runs
 * on the joined `organization` document, so a link in a home with the module off
 * is dropped in the database rather than filtered afterwards.
 */
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

/**
 * Active links of a user, joined to their organization and limited to those whose
 * organization has the module on. Oldest link first, so "the first resident" is
 * stable.
 */
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

/**
 * The links a user may act through, read live from the database on every request.
 * Links in an organization that has Family Engagement switched off are left out,
 * so turning the module off hides the data without deleting it.
 */
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

/**
 * Linked residents with display fields, for the resident picker and login, in one
 * aggregation. `activeResidentId` is the resident the app is currently showing;
 * when it is missing or not linked, the member's first resident is flagged.
 */
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

/**
 * One email holds one role. An account with any staff membership, or a platform
 * admin, is a staff account and cannot be a family member.
 */
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
