const { Resident } = require("@models/Resident");
const { Organization } = require("@models/Organization");
const { User } = require("@models/UserModel");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyUpload } = require("@models/FamilyUpload");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const {
  FamilyMemberStatus,
  FamilyUploadStatus,
  FamilyGazetteItemStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const {
  toObjectId,
  joinOne,
  personFields,
} = require("@appServices/family/familyPipeline");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");

const loadSharing = async (residentId) => {
  const [resident] = await Resident.aggregate([
    { $match: { _id: toObjectId(residentId) } },
    ...joinOne({
      from: Organization,
      localField: "organizationId",
      as: "organization",
      optional: true,
    }),
    {
      $project: {
        organizationId: 1,
        photographyConsent: 1,
        photosSeenAt: 1,
        "organization.moduleAccess": 1,
      },
    },
  ]);
  if (!resident) throw new AppError("resident_not_found", 404);
  return resident;
};

const listFamilyMembers = (residentId) =>
  FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    { $sort: { isNextOfKin: -1, createdAt: 1, _id: 1 } },
    ...joinOne({ from: User, localField: "userId", as: "user" }),
    {
      $project: {
        _id: 0,
        memberId: "$_id",
        ...personFields(),
        relationship: 1,
        isNextOfKin: { $ifNull: ["$isNextOfKin", false] },
      },
    },
  ]);

const latestPrintedGazette = async ({ residentId, organizationId }) => {
  const [gazette] = await FamilyGazetteItem.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        organizationId: toObjectId(organizationId),
        status: FamilyGazetteItemStatus.PRINTED,
      },
    },
    { $sort: { printedAt: -1, _id: -1 } },
    { $limit: 1 },
    ...joinOne({
      from: FamilyGazetteIssue,
      localField: "issueId",
      as: "issue",
      optional: true,
    }),
    {
      $project: {
        _id: 0,
        gazetteId: "$_id",
        issueNumber: { $ifNull: ["$issue.number", 0] },
        messageCount: { $size: { $ifNull: ["$uploadIds", []] } },
      },
    },
  ]);
  return gazette || null;
};

const countNewPhotos = async ({ residentId, organizationId, seenAt }) => {
  const [result] = await FamilyUpload.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        organizationId: toObjectId(organizationId),
        status: FamilyUploadStatus.APPROVED,
        ...(seenAt ? { decidedAt: { $gt: seenAt } } : {}),
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: { $size: { $ifNull: ["$mediaIds", []] } } },
      },
    },
  ]);
  return result?.count || 0;
};

const familyNote = ({ members, photoSharing }) => {
  const kinName = String(
    members.find((member) => member.isNextOfKin)?.name || "",
  )
    .trim()
    .split(/\s+/)[0];
  const ask = `To add someone, ask a member of staff${kinName ? ` or ${kinName}` : ""}.`;
  if (!members.length) return ask;
  const shared = photoSharing ? "your photos and gazette" : "your gazette";
  return `These people can see ${shared}. ${ask}`;
};

const getFamilyScreen = async ({ resident }) => {
  const sharing = await loadSharing(resident.residentId);
  const familyActive = isFamilyModuleActive(sharing.organization);
  const photoSharing = familyActive && sharing.photographyConsent === true;
  const scope = {
    residentId: resident.residentId,
    organizationId: sharing.organizationId,
  };

  const [members, gazette, newCount] = await Promise.all([
    familyActive ? listFamilyMembers(resident.residentId) : [],
    familyActive ? latestPrintedGazette(scope) : null,
    photoSharing
      ? countNewPhotos({ ...scope, seenAt: sharing.photosSeenAt })
      : 0,
  ]);

  return {
    resident: {
      name: resident.name,
      photoUrl: resident.photoUrl,
      homeName: resident.branchName,
    },
    family: {
      count: members.length,
      members,
      note: familyNote({ members, photoSharing }),
    },
    gazette,
    photos: { newCount },
  };
};

module.exports = { countNewPhotos, getFamilyScreen, loadSharing, latestPrintedGazette };
